import type { PoolClient } from "pg";
import { getSources, hash } from "./storage.js";
import { curationInput } from "./curation-input.js";
import { sourceRoles, type SourceRole } from "./source-roles.js";
import { ModelError } from "./ai.js";
import { curationHeads } from "./curation-queue.js";
import { randomUUID } from "node:crypto";

// A user-visible pass fixes all currently received inputs for this session.
// Small model batches stay bounded, but cannot absorb later collection increments.
export async function captureCycle(c: PoolClient, ws: string, job: any) {
  if (job.cycle_id) return job;
  const cycle = randomUUID();
  const result = await c.query(
    `UPDATE refinement_jobs j SET cycle_id=$3,cycle_started_at=now()
     FROM sources s, sources head
     WHERE j.workspace_id=$1 AND s.workspace_id=$1 AND head.workspace_id=$1
       AND s.id=j.source_id AND head.id=$2 AND s.deleted_at IS NULL
       AND j.status<>'completed' AND j.cycle_id IS NULL
       AND (s.id=head.id OR (s.kind='conversation' AND head.kind='conversation'
         AND s.origin<>'' AND s.origin=head.origin)) RETURNING j.*`,
    [ws, job.source_id, cycle],
  );
  return result.rows.find((row) => row.id === job.id) ?? job;
}

// Capture a bounded, immutable prefix. New arrivals belong to the next batch.
// Per-source rows remain a coverage ledger; children are not runnable jobs.
export async function captureBatch(c: PoolClient, ws: string, job: any) {
  job = await captureCycle(c, ws, job);
  if (
    job.input_sources?.length ||
    job.chunk_plan ||
    job.chunk_index ||
    job.output ||
    job.attempts
  )
    return job;
  const candidates = (
    await c.query(
      `WITH ordered AS (${curationHeads})
    SELECT j.*,s.content_hash,s.line_count FROM ordered h
    JOIN refinement_jobs j ON j.id=h.id JOIN sources s ON s.id=j.source_id
    WHERE s.workspace_id=$1 AND j.cycle_id=$3 AND
      (s.id=$2 OR (s.kind='conversation' AND (SELECT kind FROM sources WHERE id=$2 AND workspace_id=$1)='conversation' AND s.origin<>'' AND s.origin=(SELECT origin FROM sources WHERE id=$2 AND workspace_id=$1)))
    ORDER BY h.queue_position LIMIT 32 FOR UPDATE OF j`,
      [ws, job.source_id, job.cycle_id],
    )
  ).rows;
  const selected: any[] = [];
  let lines = 0;
  for (const candidate of candidates) {
    if (
      candidate.generation !== job.generation ||
      candidate.status !== "pending" ||
      candidate.chunk_plan ||
      candidate.chunk_index ||
      candidate.output ||
      candidate.attempts ||
      candidate.input_sources?.length ||
      new Date(candidate.available_at).getTime() > Date.now()
    )
      break;
    if (selected.length && lines + candidate.line_count > 4096) break;
    selected.push(candidate);
    lines += candidate.line_count;
  }
  if (selected[0]?.id !== job.id) return job;
  const sources = selected.map((s) => ({
    id: s.source_id,
    hash: s.content_hash,
  }));
  await c.query(
    "UPDATE refinement_jobs SET input_sources=$3 WHERE workspace_id=$1 AND id=$2",
    [ws, job.id, JSON.stringify(sources)],
  );
  if (selected.length > 1)
    await c.query(
      "UPDATE refinement_jobs SET batch_parent=$3 WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
      [ws, selected.slice(1).map((s) => s.id), job.id],
    );
  return { ...job, input_sources: sources };
}

export type SourceSpan = {
  id: string;
  hash: string;
  start: number;
  end: number;
};
// One bounded, process-local input cache. Immutable IDs/hashes are rechecked in
// DB on every use; no disk copy or durable derived source is introduced.
let cachedBatch:
  { key: string; value: Awaited<ReturnType<typeof buildBatch>> } | undefined;
export async function readBatch(c: PoolClient, ws: string, job: any) {
  const refs = job.input_sources?.length
    ? job.input_sources
    : [{ id: job.source_id }];
  const rows = (
    await c.query(
      "SELECT id,content_hash FROM sources WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL",
      [ws, refs.map((r: any) => r.id)],
    )
  ).rows;
  const key = JSON.stringify([
    ws,
    refs.map((ref: any) => {
      const row = rows.find((s) => s.id === ref.id);
      if (!row) throw new ModelError("SOURCE_DELETED");
      if (ref.hash && row.content_hash !== ref.hash)
        throw new ModelError("SOURCE_HASH_MISMATCH");
      return [row.id, row.content_hash];
    }),
  ]);
  if (cachedBatch?.key === key) return cachedBatch.value;
  cachedBatch = undefined;
  const value = await buildBatch(c, ws, job);
  if (Buffer.byteLength(value.text) <= 8 * 1024 * 1024)
    cachedBatch = { key, value };
  return value;
}
async function buildBatch(c: PoolClient, ws: string, job: any) {
  const refs: { id: string; hash?: string }[] = job.input_sources?.length
    ? job.input_sources
    : [{ id: job.source_id }];
  const texts: string[] = [],
    spans: SourceSpan[] = [],
    roles: SourceRole[] = [];
  let offset = 0,
    omittedBytes = 0;
  const omitted: ReturnType<typeof curationInput>["omitted"] = [];
  const rows = (
    await c.query(
      "SELECT id,object_key,content_hash FROM sources WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL",
      [ws, refs.map((r) => r.id)],
    )
  ).rows;
  const sources = refs.map((ref) => {
    const source = rows.find((s) => s.id === ref.id);
    if (!source) throw new ModelError("SOURCE_DELETED");
    return source;
  });
  const originals = await getSources(sources.map((s) => s.object_key));
  for (const [index, ref] of refs.entries()) {
    const source = sources[index],
      original = originals[index];
    if (
      hash(original) !== source.content_hash ||
      (ref.hash && ref.hash !== source.content_hash)
    )
      throw new ModelError("SOURCE_HASH_MISMATCH");
    // Project and derive roles within each original. Event IDs may repeat in a
    // different file generation; do not infer authority across source boundaries.
    const projection = curationInput(original),
      count = projection.text.split("\n").length;
    texts.push(projection.text);
    roles.push(...sourceRoles(original));
    spans.push({
      id: source.id,
      hash: source.content_hash,
      start: offset + 1,
      end: offset + count,
    });
    omitted.push(
      ...projection.omitted.map((r) => ({
        ...r,
        start: r.start + offset,
        end: r.end + offset,
      })),
    );
    omittedBytes += projection.omittedBytes;
    offset += count;
  }
  const text = texts.join("\n");
  return {
    text,
    roles,
    spans,
    omitted,
    omittedBytes,
    contentHash:
      refs.length === 1 ? spans[0].hash : hash(JSON.stringify(spans)),
  };
}

// Evidence is validated against the fixed input view first, then translated to
// original L1 IDs and local rows. A quote spanning two files becomes two exact
// citations, never a synthetic source or a rewritten raw record.
export function originalEvidence<
  T extends {
    sourceId: string;
    revision: number;
    lines: [number, number];
    quote: string;
  },
>(e: T, spans: SourceSpan[]): T[] {
  const lines = e.quote.split("\n");
  const mapped = spans
    .filter((s) => s.start <= e.lines[1] && s.end >= e.lines[0])
    .map((s) => {
      const start = Math.max(e.lines[0], s.start),
        end = Math.min(e.lines[1], s.end);
      return {
        ...e,
        sourceId: s.id,
        lines: [start - s.start + 1, end - s.start + 1] as [number, number],
        quote: lines.slice(start - e.lines[0], end - e.lines[0] + 1).join("\n"),
      };
    });
  if (
    mapped.reduce((n, x) => n + x.lines[1] - x.lines[0] + 1, 0) !==
    e.lines[1] - e.lines[0] + 1
  )
    throw new ModelError("AI_EVIDENCE_REQUIRED");
  return mapped;
}
