import type { PoolClient } from "pg";
import { AppError } from "../../../packages/core/src/db.js";

// Small, workspace-wide reset: retain source records, collection cursors and
// model call history. The caller wraps this in the existing scoped transaction.
export async function rebuildCuration(
  c: PoolClient,
  ws: string,
  requestId: string,
) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    ws + "settings",
  ]);
  const previous = (
    await c.query(
      "SELECT result FROM curation_rebuilds WHERE workspace_id=$1 AND id=$2",
      [ws, requestId],
    )
  ).rows[0];
  if (previous) return previous.result;
  const settings = (
    await c.query("SELECT config FROM ai_settings WHERE workspace_id=$1", [ws])
  ).rows[0];
  if (settings?.config.enabled)
    throw new AppError(409, "CURATION_PAUSE_REQUIRED");
  const jobs = (
    await c.query(
      "SELECT id,status FROM refinement_jobs WHERE workspace_id=$1 ORDER BY id FOR UPDATE",
      [ws],
    )
  ).rows;
  if (jobs.some((j) => j.status === "running"))
    throw new AppError(409, "CURATION_STILL_RUNNING");
  // Same lock as manual publications. Worker admission takes the settings lock
  // before a job lock; publication takes a job lock before this knowledge lock.
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [ws]);
  const sources = (
    await c.query(
      "SELECT id FROM sources WHERE workspace_id=$1 AND deleted_at IS NULL",
      [ws],
    )
  ).rows.map((s) => s.id);
  const removed = (
    await c.query(
      "SELECT count(*)::int AS n FROM articles WHERE workspace_id=$1",
      [ws],
    )
  ).rows[0].n;
  for (const table of [
    "claim_relations",
    "evidence",
    "claims",
    "links",
    "project_contexts",
    "revisions",
    "articles",
    "publications",
  ]) {
    await c.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [ws]);
  }
  // Keep job IDs so diagnostic runs retain their references. A new generation
  // and cleared run ID fence old responses and give new publications fresh keys.
  await c.query(
    `UPDATE refinement_jobs SET generation=generation+1,status='pending',attempts=0,
    available_at=now(),lease_until=NULL,run_id=NULL,output=NULL,result=NULL,error_code=NULL,
    batch_parent=NULL,input_sources=NULL,chunk_plan=NULL,chunk_index=0,chunk_count=0,chunk_results='[]',updated_at=now()
    WHERE workspace_id=$1 AND source_id=ANY($2::uuid[])`,
    [ws, sources],
  );
  await c.query(
    `INSERT INTO refinement_jobs(id,workspace_id,source_id,generation)
    SELECT gen_random_uuid(),$1,id,1 FROM sources WHERE workspace_id=$1 AND id=ANY($2::uuid[])
    ON CONFLICT(workspace_id,source_id) DO NOTHING`,
    [ws, sources],
  );
  const result = {
    id: requestId,
    sources: sources.length,
    removedArticles: removed,
    enabled: false,
  };
  await c.query(
    "INSERT INTO curation_rebuilds(id,workspace_id,result) VALUES($1,$2,$3)",
    [requestId, ws, JSON.stringify(result)],
  );
  return result;
}
