import type { PoolClient } from "pg";
import { AppError } from "../../../packages/core/src/db.js";
import { hash } from "../../../packages/core/src/storage.js";
export async function reprocessPlan(c: PoolClient, ws: string, runId: string) {
  const run = (
    await c.query(
      "SELECT r.*,j.source_id FROM refinement_runs r JOIN refinement_jobs j ON j.id=r.job_id WHERE r.workspace_id=$1 AND r.id=$2",
      [ws, runId],
    )
  ).rows[0];
  if (!run || !run.input?.source?.spans?.length || !run.input.source.text)
    throw new AppError(400, "REPROCESS_INPUT_UNAVAILABLE");
  if (run.status !== "completed")
    throw new AppError(409, "USE_RETRY_FOR_FAILED_RUN");
  const spans = run.input.source.spans.filter(
    (s: any) =>
      s.start <= run.input.source.end && s.end >= run.input.source.start,
  );
  const claims = (
    await c.query(
      `SELECT DISTINCT cl.article_id,cl.revision,cl.anchor,cl.text,cl.type,cl.subject,cl.scope,cl.state,a.topic_key,a.topic_title,a.title,
 EXISTS(SELECT 1 FROM knowledge_reviews kr WHERE kr.workspace_id=cl.workspace_id AND kr.article_id=cl.article_id AND kr.revision=cl.revision) AS reviewed
 FROM claims cl JOIN articles a ON a.workspace_id=cl.workspace_id AND a.id=cl.article_id JOIN evidence e ON e.workspace_id=cl.workspace_id AND e.article_id=cl.article_id AND e.revision=cl.revision AND e.anchor=cl.anchor
 WHERE cl.workspace_id=$1 AND cl.revision=a.revision AND a.deleted_at IS NULL AND e.source_id=ANY($2::uuid[]) ORDER BY cl.article_id,cl.anchor`,
      [ws, spans.map((s: any) => s.id)],
    )
  ).rows;
  const plan = {
    runId,
    source: {
      id: run.input.source.id,
      start: run.input.source.start,
      end: run.input.source.end,
      spans: run.input.source.spans,
      inputHash: hash(run.input.source.text),
    },
    originalPromptVersion: run.prompt_version,
    originalInputVersion: run.diagnostics?.inputVersion,
    claims,
    pages: [...new Set(claims.map((c) => c.topic_key).filter(Boolean))],
  };
  return { ...plan, fingerprint: hash(JSON.stringify(plan)), modelCalls: 1 };
}
export async function enqueueReprocess(
  c: PoolClient,
  ws: string,
  body: {
    requestId: string;
    runId: string;
    fingerprint: string;
    mode: string;
    reason: string;
  },
) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    ws + "settings",
  ]);
  const old = (
    await c.query(
      "SELECT * FROM curation_reprocesses WHERE workspace_id=$1 AND id=$2",
      [ws, body.requestId],
    )
  ).rows[0];
  if (old) {
    if (
      old.original_run_id !== body.runId ||
      old.mode !== body.mode ||
      old.reason !== body.reason ||
      old.plan.fingerprint !== body.fingerprint
    )
      throw new AppError(409, "IDEMPOTENCY_CONFLICT");
    return { id: old.id, status: old.status };
  }
  const plan = await reprocessPlan(c, ws, body.runId);
  if (plan.fingerprint !== body.fingerprint)
    throw new AppError(409, "REPROCESS_PLAN_CHANGED");
  await c.query(
    "INSERT INTO curation_reprocesses(workspace_id,id,original_run_id,mode,reason,plan) VALUES($1,$2,$3,$4,$5,$6)",
    [
      ws,
      body.requestId,
      body.runId,
      body.mode,
      body.reason,
      JSON.stringify(plan),
    ],
  );
  return {
    id: body.requestId,
    status: "pending",
    startsOnlyWhenCurationEnabled: true,
  };
}
