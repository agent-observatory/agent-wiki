import type { PoolClient } from "pg";
import { sourceRecordTimes } from "../../../packages/core/src/evidence-time.js";
import { getSources, hash } from "../../../packages/core/src/storage.js";
import { AppError } from "../../../packages/core/src/db.js";
export async function cacheSourceTimes(
  c: PoolClient,
  ws: string,
  id: string,
  text: string,
) {
  const rows = sourceRecordTimes(text);
  if (rows.length)
    await c.query(
      "INSERT INTO source_record_times(workspace_id,source_id,line,recorded_at,time_kind) SELECT $1,$2,x.line,x.time::timestamptz,x.kind FROM jsonb_to_recordset($3::jsonb) AS x(line int,time text,kind text) ON CONFLICT DO NOTHING",
      [ws, id, JSON.stringify(rows)],
    );
}
// Every line an evidence record spans, joined against the recorded/recovered
// times cached at publish time (cacheSourceTimes below). Shared by the
// SUPERSEDES_BACKWARD_IN_TIME gate (claim-relations.ts) and the consolidation
// plan dry run (consolidation-control.ts).
export async function claimEvidenceTimes(
  c: PoolClient,
  ws: string,
  articleId: string,
  revision: number,
  anchor: string,
): Promise<{ time_kind: string; recorded_at: string }[]> {
  return (
    await c.query(
      `SELECT srt.time_kind,srt.recorded_at FROM evidence e
       JOIN source_record_times srt ON srt.workspace_id=e.workspace_id AND srt.source_id=e.source_id AND srt.line BETWEEN e.line_start AND e.line_end
       WHERE e.workspace_id=$1 AND e.article_id=$2 AND e.revision=$3 AND e.anchor=$4`,
      [ws, articleId, revision, anchor],
    )
  ).rows;
}
export async function backfillEvidenceTimes(c: PoolClient, ws: string) {
  const sources = (
    await c.query(
      "SELECT DISTINCT s.id,s.object_key,s.content_hash FROM sources s JOIN evidence e ON e.workspace_id=s.workspace_id AND e.source_id=s.id WHERE s.workspace_id=$1 AND s.deleted_at IS NULL",
      [ws],
    )
  ).rows;
  // Small personal Wiki: bounded batches of existing source objects, no model call.
  for (let i = 0; i < sources.length; i += 8) {
    const batch = sources.slice(i, i + 8),
      texts = await getSources(batch.map((s) => s.object_key));
    for (let j = 0; j < batch.length; j++) {
      if (hash(texts[j]) !== batch[j].content_hash)
        throw new AppError(409, "SOURCE_HASH_MISMATCH");
      await cacheSourceTimes(c, ws, batch[j].id, texts[j]);
    }
  }
  return sources.length;
}
