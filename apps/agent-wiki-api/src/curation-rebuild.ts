import type { PoolClient } from "pg";
import { AppError } from "../../../packages/core/src/db.js";

// Small, workspace-wide reset: retain source records, collection cursors and
// model call history. The caller wraps this in the existing scoped transaction.
// An optional sourceIds scopes which sources get re-queued: everything else
// keeps its raw source but loses its refinement_jobs row, so it is honestly
// "not yet curated" rather than silently marked done (refinement-sessions.ts,
// knowledge-context.ts, query.ts read that absence).
export async function rebuildCuration(
  c: PoolClient,
  ws: string,
  requestId: string,
  sourceIds?: string[],
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
  if (
    (
      await c.query(
        "SELECT 1 FROM curation_reprocesses WHERE workspace_id=$1 AND status='running' LIMIT 1",
        [ws],
      )
    ).rowCount
  )
    throw new AppError(409, "CURATION_STILL_RUNNING");
  await c.query(
    "UPDATE curation_reprocesses SET status='failed',error_code='REPROCESS_PLAN_CHANGED',updated_at=now() WHERE workspace_id=$1 AND status IN ('pending','ready')",
    [ws],
  );
  // Same lock as manual publications. Worker admission takes the settings lock
  // before a job lock; publication takes a job lock before this knowledge lock.
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [ws]);
  const sources = (
    await c.query(
      "SELECT id FROM sources WHERE workspace_id=$1 AND deleted_at IS NULL",
      [ws],
    )
  ).rows.map((s) => s.id);
  const scopeSet = sourceIds ? new Set(sourceIds) : null;
  const scoped = scopeSet ? sources.filter((id) => scopeSet.has(id)) : sources;
  const unscoped = scopeSet ? sources.filter((id) => !scopeSet.has(id)) : [];
  const removed = (
    await c.query(
      "SELECT count(*)::int AS n FROM articles WHERE workspace_id=$1",
      [ws],
    )
  ).rows[0].n;
  // Consolidation's tables are workspace-wide L3 state too: an inbox row FKs
  // to claims, a rejection FKs to publications, and refinement_runs.job_id/
  // consolidation_job_id must be cleared before their parents disappear.
  await c.query(
    "UPDATE refinement_runs SET consolidation_job_id=NULL WHERE workspace_id=$1 AND kind='consolidation'",
    [ws],
  );
  for (const table of [
    "wiki_page_versions",
    "wiki_pages",
    "consolidation_inbox",
    "claim_relations",
    "evidence",
    "claims",
    "links",
    "project_contexts",
    "revisions",
    "articles",
    "claim_relation_rejections",
    "publications",
    "consolidation_jobs",
  ]) {
    await c.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [ws]);
  }
  // Keep job IDs so diagnostic runs retain their references. A new generation
  // and cleared run ID fence old responses and give new publications fresh keys.
  await c.query(
    `UPDATE refinement_jobs SET generation=generation+1,status='pending',attempts=0,
    available_at=now(),lease_until=NULL,run_id=NULL,output=NULL,result=NULL,error_code=NULL,
    batch_parent=NULL,input_sources=NULL,cycle_id=NULL,cycle_started_at=NULL,chunk_plan=NULL,chunk_index=0,chunk_count=0,chunk_results='[]',updated_at=now()
    WHERE workspace_id=$1 AND source_id=ANY($2::uuid[])`,
    [ws, scoped],
  );
  await c.query(
    `INSERT INTO refinement_jobs(id,workspace_id,source_id,generation)
    SELECT gen_random_uuid(),$1,id,1 FROM sources WHERE workspace_id=$1 AND id=ANY($2::uuid[])
    ON CONFLICT(workspace_id,source_id) DO NOTHING`,
    [ws, scoped],
  );
  // Every other source keeps its immutable L1 object but loses its job row: it
  // is honestly "not yet curated" rather than reset-and-implicitly-current.
  if (unscoped.length)
    await c.query(
      "DELETE FROM refinement_jobs WHERE workspace_id=$1 AND source_id=ANY($2::uuid[])",
      [ws, unscoped],
    );
  const result = {
    id: requestId,
    sources: sources.length,
    queued: scoped.length,
    unqueued: unscoped.length,
    removedArticles: removed,
    enabled: false,
  };
  await c.query(
    "INSERT INTO curation_rebuilds(id,workspace_id,result) VALUES($1,$2,$3)",
    [requestId, ws, JSON.stringify(result)],
  );
  return result;
}

// A scoped rebuild leaves every source it did not queue with its raw L1 intact
// and no refinement_jobs row, which four coverage queries correctly report as
// "not yet curated". Without a way back in, that honesty is a dead end: the
// only path was another rebuild, which wipes all of L3 including the user's
// own feedback claims. Queue adds the jobs without touching knowledge.
export async function queueCuration(
  c: PoolClient,
  ws: string,
  sourceIds?: string[],
) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    ws + "settings",
  ]);
  const rows = (
    await c.query(
      `SELECT s.id FROM sources s
       LEFT JOIN refinement_jobs j ON j.workspace_id=s.workspace_id AND j.source_id=s.id
       WHERE s.workspace_id=$1 AND s.deleted_at IS NULL AND s.kind='conversation'
         AND j.id IS NULL AND ($2::uuid[] IS NULL OR s.id=ANY($2::uuid[]))
       ORDER BY s.created_at`,
      [ws, sourceIds ?? null],
    )
  ).rows.map((r) => r.id as string);
  if (rows.length)
    await c.query(
      `INSERT INTO refinement_jobs(id,workspace_id,source_id,generation)
       SELECT gen_random_uuid(),$1,id,1 FROM unnest($2::uuid[]) AS id
       ON CONFLICT(workspace_id,source_id) DO NOTHING`,
      [ws, rows],
    );
  const remaining = (
    await c.query(
      `SELECT count(*)::int AS n FROM sources s
       LEFT JOIN refinement_jobs j ON j.workspace_id=s.workspace_id AND j.source_id=s.id
       WHERE s.workspace_id=$1 AND s.deleted_at IS NULL AND s.kind='conversation' AND j.id IS NULL`,
      [ws],
    )
  ).rows[0].n;
  return { queued: rows.length, stillUnqueued: remaining };
}
