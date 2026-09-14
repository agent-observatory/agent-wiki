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
  const items = (
    await c.query(
      "SELECT DISTINCT ON (topic_key) * FROM consolidation_jobs WHERE workspace_id=$1 ORDER BY topic_key,created_at DESC",
      [ws],
    )
  ).rows;
  return { items };
}
