import type { PoolClient } from "pg";
// A cycle (docs/l2-l3-memory.md#언제-실행하나) is the fixed set of jobs one
// session's backlog was split into when processing began (captureCycle);
// it can span more than one 32-source batch. Only once every job sharing a
// cycle_id has completed do we know which topics that cycle actually
// touched, so this is called from the one spot a chunk job finishes.
export async function scheduleConsolidationForCycle(
  c: PoolClient,
  ws: string,
  cycleId: string | null,
) {
  if (!cycleId) return;
  const remaining = (
    await c.query(
      "SELECT count(*)::int AS n FROM refinement_jobs WHERE workspace_id=$1 AND cycle_id=$2 AND status<>'completed'",
      [ws, cycleId],
    )
  ).rows[0].n;
  if (remaining > 0) return;
  const topics = (
    await c.query(
      `SELECT DISTINCT a.topic_key FROM refinement_jobs j
       JOIN jsonb_array_elements(COALESCE(j.result->'items','[]'::jsonb)) AS item ON true
       JOIN articles a ON a.workspace_id=j.workspace_id AND a.id=(item->>'id')::uuid
       WHERE j.workspace_id=$1 AND j.cycle_id=$2 AND a.topic_key<>'' AND a.deleted_at IS NULL`,
      [ws, cycleId],
    )
  ).rows;
  for (const { topic_key } of topics) await scheduleConsolidation(c, ws, topic_key, "cycle");
}
// At most one open (pending/running) Job per topic. A repeat trigger while
// one is already open never creates a second Job; it only flags
// rerun_requested, and advanceJob (consolidate.ts) rolls that Job straight
// into a fresh gather once the open one finishes
// (docs/l2-l3-memory.md#job과-step).
export async function scheduleConsolidation(
  c: PoolClient,
  ws: string,
  topicKey: string,
  trigger: "cycle" | "deferred" | "manual",
) {
  return c.query(
    `INSERT INTO consolidation_jobs(workspace_id,topic_key,trigger) VALUES($1,$2,$3)
     ON CONFLICT (workspace_id,topic_key) WHERE status IN ('pending','running') DO UPDATE SET rerun_requested=true`,
    [ws, topicKey, trigger],
  );
}
