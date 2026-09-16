import type { PoolClient } from "pg";
import { effectiveClaimState } from "./claim-relations.js";
import { claimEvidenceTimes } from "./evidence-time.js";
// `agent-wiki review conflicts`: read-only, zero model calls, nothing
// written. The three things a person must look at before deciding anything —
// reading a Wiki Page is not review. docs/l2-l3-memory.md#통합--consolidation.
export type ConflictClaimRef = {
  articleId: string;
  revision: number;
  anchor: string;
  text: string;
  state: string;
  topicKey: string;
  evidenceTimes: { time_kind: string; recorded_at: string }[];
};
export async function conflictsReview(
  c: PoolClient,
  ws: string,
  topicKey?: string,
) {
  const key = topicKey ?? null;
  const contradictions = (
    await c.query(
      `SELECT cr.from_article_id,cr.from_revision,cr.from_anchor,cr.to_article_id,cr.to_revision,cr.to_anchor,
        fcl.text AS from_text,fcl.subject,fcl.scope,${effectiveClaimState("fcl")} AS from_state,
        tcl.text AS to_text,${effectiveClaimState("tcl")} AS to_state,
        fa.topic_key AS from_topic,ta.topic_key AS to_topic
       FROM claim_relations cr
       JOIN claims fcl ON fcl.workspace_id=cr.workspace_id AND fcl.article_id=cr.from_article_id AND fcl.revision=cr.from_revision AND fcl.anchor=cr.from_anchor
       JOIN claims tcl ON tcl.workspace_id=cr.workspace_id AND tcl.article_id=cr.to_article_id AND tcl.revision=cr.to_revision AND tcl.anchor=cr.to_anchor
       JOIN articles fa ON fa.workspace_id=cr.workspace_id AND fa.id=cr.from_article_id
       JOIN articles ta ON ta.workspace_id=cr.workspace_id AND ta.id=cr.to_article_id
       WHERE cr.workspace_id=$1 AND cr.relation='contradicts'
       AND ($2::text IS NULL OR fa.topic_key=$2 OR ta.topic_key=$2)
       ORDER BY cr.created_at`,
      [ws, key],
    )
  ).rows.filter(
    (r) => r.from_state === "conflicted" || r.to_state === "conflicted",
  );
  const conflicts = await Promise.all(
    contradictions.map(async (r) => ({
      subject: r.subject,
      scope: r.scope,
      from: {
        articleId: r.from_article_id,
        revision: r.from_revision,
        anchor: r.from_anchor,
        text: r.from_text,
        state: r.from_state,
        topicKey: r.from_topic,
        evidenceTimes: await claimEvidenceTimes(
          c,
          ws,
          r.from_article_id,
          r.from_revision,
          r.from_anchor,
        ),
      } satisfies ConflictClaimRef,
      to: {
        articleId: r.to_article_id,
        revision: r.to_revision,
        anchor: r.to_anchor,
        text: r.to_text,
        state: r.to_state,
        topicKey: r.to_topic,
        evidenceTimes: await claimEvidenceTimes(
          c,
          ws,
          r.to_article_id,
          r.to_revision,
          r.to_anchor,
        ),
      } satisfies ConflictClaimRef,
    })),
  );
  const inbox = (
    await c.query(
      `SELECT ci.id,ci.from_article_id,ci.from_revision,ci.from_anchor,ci.to_article_id,ci.to_revision,ci.to_anchor,
        ci.relation,ci.error_code,ci.created_at,fa.topic_key
       FROM consolidation_inbox ci
       JOIN articles fa ON fa.workspace_id=ci.workspace_id AND fa.id=ci.from_article_id
       WHERE ci.workspace_id=$1 AND ci.status='pending' AND ($2::text IS NULL OR fa.topic_key=$2)
       ORDER BY ci.created_at`,
      [ws, key],
    )
  ).rows.map((r) => ({
    id: r.id,
    from: {
      articleId: r.from_article_id,
      revision: r.from_revision,
      anchor: r.from_anchor,
    },
    to: {
      articleId: r.to_article_id,
      revision: r.to_revision,
      anchor: r.to_anchor,
    },
    relation: r.relation,
    errorCode: r.error_code,
    topicKey: r.topic_key,
    createdAt: r.created_at,
  }));
  const leaveUnresolved = (
    await c.query(
      `SELECT id,topic_key,updated_at,COALESCE(steps->'model'->'output'->'leaveUnresolved','[]'::jsonb) AS reasons
       FROM consolidation_jobs
       WHERE workspace_id=$1 AND status='completed' AND ($2::text IS NULL OR topic_key=$2)
       AND jsonb_array_length(COALESCE(steps->'model'->'output'->'leaveUnresolved','[]'::jsonb))>0
       ORDER BY updated_at DESC`,
      [ws, key],
    )
  ).rows.map((r) => ({
    jobId: r.id,
    topicKey: r.topic_key,
    updatedAt: r.updated_at,
    reasons: r.reasons as { subject: string; scope: string; reason: string }[],
  }));
  return { conflicts, inbox, leaveUnresolved };
}
