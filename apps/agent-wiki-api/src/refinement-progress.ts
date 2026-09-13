import { curationHeads } from "../../../packages/core/src/curation-queue.js";
import { sessionProgress } from "./session-progress.js";
import type { PoolClient } from "pg";
import { decryptSecret, defaults } from "../../../packages/core/src/ai.js";
import { modelGateKey } from "../../../packages/core/src/model-gate.js";

export function refinementSchedule(input: {
  enabled: boolean;
  hasKey: boolean;
  calls: number;
  dailyCalls: number | null;
  pending: number;
  eligible?: number;
  running: number;
  failed: number;
  earliest: string | Date | null;
  cooldown: string | Date | null;
  now: Date;
}) {
  const { now } = input;
  if (!input.enabled)
    return {
      reason: input.running ? "pausing" : "paused",
      nextAttemptAt: null,
    };
  if (input.running) return { reason: "running", nextAttemptAt: null };
  if (!input.pending || input.eligible === 0)
    return {
      reason: input.failed ? "needs_attention" : "idle",
      nextAttemptAt: null,
    };
  if (!input.hasKey) return { reason: "key_missing", nextAttemptAt: null };
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  const waits = [
    {
      reason: "retry_wait",
      at: input.earliest ? new Date(input.earliest).getTime() : 0,
    },
    {
      reason: "provider_cooldown",
      at: input.cooldown ? new Date(input.cooldown).getTime() : 0,
    },
    {
      reason: "daily_limit",
      at:
        input.dailyCalls !== null && input.calls >= input.dailyCalls
          ? tomorrow.getTime()
          : 0,
    },
  ].sort((a, b) => b.at - a.at);
  return waits[0].at > now.getTime()
    ? {
        reason: waits[0].reason,
        nextAttemptAt: new Date(waits[0].at).toISOString(),
      }
    : { reason: "ready", nextAttemptAt: null };
}

export async function refinementProgress(
  c: PoolClient,
  ws: string,
  calls: number,
) {
  const summary = (
    await c.query(
      `WITH heads AS (${curationHeads}) SELECT count(*)::int AS total,
      count(*) FILTER(WHERE j.status='completed')::int AS completed,
      count(*) FILTER(WHERE j.status='pending')::int AS pending,
      count(*) FILTER(WHERE j.status='pending' AND j.id IN (SELECT id FROM heads WHERE queue_position=1))::int AS eligible,
      count(*) FILTER(WHERE j.status='running')::int AS running,
      count(*) FILTER(WHERE j.status='failed')::int AS failed,
      count(*) FILTER(WHERE j.chunk_count=0 AND j.status<>'completed' AND j.batch_parent IS NULL AND j.input_sources IS NULL)::int AS unplanned,
      coalesce(sum(j.chunk_index),0)::int AS chunks_done,
      coalesce(sum(j.chunk_count),0)::int AS chunks_total,
      min(j.available_at) FILTER(WHERE j.status='pending' AND j.id IN (SELECT id FROM heads WHERE queue_position=1)) AS earliest
     FROM refinement_jobs j JOIN sources s ON s.id=j.source_id AND s.workspace_id=j.workspace_id
     WHERE j.workspace_id=$1 AND s.deleted_at IS NULL`,
      [ws],
    )
  ).rows[0];
  const storage = (
    await c.query(
      `SELECT (SELECT count(*)::int FROM sources WHERE workspace_id=$1 AND deleted_at IS NULL) AS sources,
      (SELECT count(DISTINCT CASE WHEN kind='conversation' AND origin<>'' THEN 'conversation:'||origin ELSE 'source:'||id::text END)::int FROM sources WHERE workspace_id=$1 AND deleted_at IS NULL) AS source_groups,
      (SELECT count(*)::int FROM articles WHERE workspace_id=$1 AND deleted_at IS NULL) AS articles,
      count(*) FILTER(WHERE status='completed')::int AS uploads_completed,
      count(*) FILTER(WHERE status IN ('uploading','queued','verifying'))::int AS uploads_pending
     FROM collection_uploads WHERE workspace_id=$1`,
      [ws],
    )
  ).rows[0];
  const settings = (
    await c.query(
      "SELECT config,encrypted_key,version FROM ai_settings WHERE workspace_id=$1",
      [ws],
    )
  ).rows[0];
  const config = settings?.config ?? defaults;
  let cooldown = null;
  let hasKey = !!settings?.encrypted_key;
  if (hasKey) {
    let key: string | undefined;
    try {
      key = modelGateKey(config.baseUrl, decryptSecret(settings.encrypted_key));
    } catch {
      hasKey = false;
    }
    if (key)
      cooldown =
        (
          await c.query(
            "SELECT next_allowed_at FROM model_request_gates WHERE owner_id=current_setting('app.user_id',true) AND key_hash=$1",
            [key],
          )
        ).rows[0]?.next_allowed_at ?? null;
  }
  const lastProgressAt = (
    await c.query(
      "SELECT max(r.finished_at) AS at FROM refinement_runs r JOIN refinement_jobs j ON j.id=r.job_id AND j.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.status='completed' AND COALESCE((r.diagnostics->>'generation')::int,0)=j.generation",
      [ws],
    )
  ).rows[0].at;
  const sessions = await sessionProgress(c, ws);
  const sessionSummary = {
    total: sessions.length,
    current: sessions.filter((s) => s.state === "current").length,
    waiting: sessions.filter((s) => s.state !== "current").length,
    attention: sessions.filter((s) => s.state === "attention").length,
    records: sessions.reduce((n, s) => n + s.records, 0),
    lastCollectedAt:
      sessions
        .map((s) => s.collected_at)
        .sort()
        .at(-1) ?? null,
    lastReflectedAt:
      sessions
        .flatMap((s) => (s.reflected_at ? [s.reflected_at] : []))
        .sort()
        .at(-1) ?? null,
  };
  const now = new Date();
  return {
    sessions: sessionSummary,
    summary,
    storage,
    lastProgressAt,
    checkedAt: now.toISOString(),
    control: {
      enabled: config.enabled,
      version: settings?.version ?? 0,
      dailyCalls: config.dailyCalls,
    },
    schedule: refinementSchedule({
      ...summary,
      enabled: config.enabled,
      hasKey,
      calls,
      dailyCalls: config.dailyCalls,
      cooldown,
      now,
    }),
  };
}
