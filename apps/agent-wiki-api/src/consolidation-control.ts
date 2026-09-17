import type { PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../../../packages/core/src/db.js";
import { scheduleConsolidation } from "../../../packages/core/src/consolidation.js";
import {
  gatherTopic,
  settledGroupHashes,
  type Group,
} from "../../agent-wiki-worker/src/consolidate.js";
import { claimEvidenceTimes } from "./evidence-time.js";
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

async function workspaceTopics(c: PoolClient, ws: string) {
  return (
    await c.query(
      "SELECT DISTINCT topic_key FROM articles WHERE workspace_id=$1 AND deleted_at IS NULL AND topic_key<>''",
      [ws],
    )
  ).rows.map((r) => r.topic_key as string);
}

// {all:true}: schedules a manual Job for every topic gatherTopic finds
// eligible (a (subject,scope) group with 2+ current claims, a pending inbox
// row, or a live contradicts) and skips the rest, so a batch trigger never
// creates a Job that would immediately no-op through to 'skipped'.
export async function triggerAllConsolidations(c: PoolClient, ws: string) {
  const scheduled: string[] = [];
  for (const topicKey of await workspaceTopics(c, ws)) {
    const gathered = await gatherTopic(
      c,
      ws,
      topicKey,
      await settledGroupHashes(c, ws, topicKey),
    );
    if (!gathered.groups.length) continue;
    await scheduleConsolidation(c, ws, topicKey, "manual");
    scheduled.push(topicKey);
  }
  return { scheduled };
}

// Read-only dry run: the exact gather a Job would freeze, with no model call
// and nothing written. ?topic= narrows to one topic (shown even if empty);
// omitted, only topics gatherTopic finds eligible are returned.
export async function consolidationPlan(
  c: PoolClient,
  ws: string,
  topicKey?: string,
) {
  const topics = topicKey ? [topicKey] : await workspaceTopics(c, ws);
  const topicPlans: { topicKey: string; groups: unknown[] }[] = [];
  for (const key of topics) {
    const gathered = await gatherTopic(
      c,
      ws,
      key,
      await settledGroupHashes(c, ws, key),
    );
    if (!topicKey && !gathered.groups.length) continue;
    topicPlans.push({
      topicKey: key,
      groups: await Promise.all(gathered.groups.map((g) => summarizeGroup(c, ws, g))),
    });
  }
  return topicKey ? (topicPlans[0] ?? { topicKey, groups: [] }) : { topics: topicPlans };
}

async function summarizeGroup(c: PoolClient, ws: string, g: Group) {
  return {
    subject: g.subject,
    // The slugs a person joined into this subject, so the plan says what was
    // merged instead of showing one name for two.
    ...(g.aliases ? { aliases: g.aliases } : {}),
    scope: g.scope,
    claims: await Promise.all(
      g.claims.map(async (claim) => {
        const recorded = (
          await claimEvidenceTimes(c, ws, claim.articleId, claim.revision, claim.anchor)
        ).filter((t) => t.time_kind === "recorded");
        return {
          articleId: claim.articleId,
          revision: claim.revision,
          anchor: claim.anchor,
          type: claim.type,
          state: claim.effectiveState,
          time: recorded.length
            ? new Date(
                Math.min(...recorded.map((t) => new Date(t.recorded_at).getTime())),
              ).toISOString()
            : null,
        };
      }),
    ),
    inboxRelations: g.inboxRelations.map(({ inboxId, ...r }) => r),
    rejectedRelations: g.rejectedRelations,
  };
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
