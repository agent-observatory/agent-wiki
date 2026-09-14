import type { PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../../../packages/core/src/db.js";
import { scheduleConsolidation } from "../../../packages/core/src/consolidation.js";
// Manual trigger and status for `agent-wiki consolidate` / `consolidate status`
// (docs/l2-l3-memory.md#언제-실행하나). Runs even while automatic curation is
// stopped; the automatic triggers alone respect that stop.
export const topicKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

export async function triggerConsolidation(
  c: PoolClient,
  ws: string,
  topicKey: string,
) {
  const exists = (
    await c.query(
      "SELECT 1 FROM articles WHERE workspace_id=$1 AND topic_key=$2 AND deleted_at IS NULL LIMIT 1",
      [ws, topicKey],
    )
  ).rowCount;
  if (!exists) throw new AppError(404, "TOPIC_NOT_FOUND");
  await scheduleConsolidation(c, ws, topicKey, "manual");
  return { ok: true };
}

export async function consolidationStatus(
  c: PoolClient,
  ws: string,
  topicKey?: string,
) {
  if (topicKey) {
    const job = (
      await c.query(
        "SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2 ORDER BY created_at DESC LIMIT 1",
        [ws, topicKey],
      )
    ).rows[0];
    return { topicKey, job: job ?? null };
  }
  // Per-topic latest Job for the web Curation dashboard and `consolidate
  // status`. Step outputs (the full gathered claim texts, proposed relations)
  // are replaced by counts: a 15-second poll must not ship every topic's
  // claims again. The single-topic form above keeps the full row.
  const items = (
    await c.query(
      `SELECT j.*,p.id AS page_id,p.title AS page_title FROM (
         SELECT DISTINCT ON (topic_key) * FROM consolidation_jobs WHERE workspace_id=$1 ORDER BY topic_key,created_at DESC
       ) j LEFT JOIN wiki_pages p ON p.workspace_id=j.workspace_id AND p.topic_key=j.topic_key
       ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'failed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,j.updated_at DESC,j.topic_key`,
      [ws],
    )
  ).rows;
  return { items: items.map(summarizeJob) };
}

function summarizeJob(row: any) {
  const steps: Record<string, any> = row.steps ?? {};
  const out = (name: string) => steps[name]?.output ?? {};
  const count = (v: unknown) => (Array.isArray(v) ? v.length : null);
  return {
    ...row,
    steps: Object.fromEntries(
      Object.entries(steps).map(([name, s]: [string, any]) => [
        name,
        {
          status: s.status,
          attempts: s.attempts,
          error_code: s.error_code ?? null,
          retry_at: s.retry_at ?? null,
        },
      ]),
    ),
    summary: {
      // model.output holds the gather result until the model step runs, so
      // `relations` is absent (null) rather than 0 before that.
      proposed: count(out("model").relations),
      leftUnresolved: count(out("model").leaveUnresolved),
      passed: count(out("validate").passed),
      rejected: count(out("validate").rejected),
      published: out("publish").published ?? null,
      inboxResolved: out("publish").inboxResolved ?? null,
    },
  };
}
