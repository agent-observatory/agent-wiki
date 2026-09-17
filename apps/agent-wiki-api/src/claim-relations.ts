import type { PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../../../packages/core/src/db.js";
import { claimEvidenceTimes } from "./evidence-time.js";

export const evidenceInput = z
  .object({
    sourceId: z.string().uuid(),
    revision: z.literal(1),
    lines: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    quote: z.string().min(1).max(10000),
  })
  .strict();
export const claimState = z.enum([
  "current",
  "proposed",
  "superseded",
  "retracted",
  "conflicted",
  "unconfirmed",
]);
export const claimRelationInput = z
  .object({
    anchor: z.string().regex(/^[\w-]{1,80}$/),
    relation: z.enum(["supersedes", "retracts", "contradicts", "supports"]),
    target: z.union([
      z
        .object({
          articleId: z.string().uuid(),
          revision: z.number().int().positive(),
          anchor: z.string().regex(/^[\w-]{1,80}$/),
        })
        .strict(),
      z
        .object({
          clientRef: z.string().min(1).max(200),
          anchor: z.string().regex(/^[\w-]{1,80}$/),
        })
        .strict(),
    ]),
    evidence: z.array(evidenceInput).min(1).max(10),
  })
  .strict();
export type ClaimRelation = z.infer<typeof claimRelationInput>;
export type ResolvedClaimRelation = Omit<ClaimRelation, "target"> & {
  target: { articleId: string; revision: number; anchor: string };
};
// Relation-only failures that mean "the world moved", not "the model is
// wrong" — the extraction stays valid, only this one relation is deferred to
// consolidation instead of discarding everything and re-calling the model.
export const DEFERRABLE_RELATION_CODES = [
  "CLAIM_TARGET_VERSION_CHANGED",
  "CLAIM_TARGET_ALREADY_RETIRED",
] as const;
export type DeferredRelation = {
  fromArticleId: string;
  fromRevision: number;
  fromAnchor: string;
  target: { articleId: string; revision: number; anchor: string };
  relation: ClaimRelation["relation"];
  evidence: ClaimRelation["evidence"];
  errorCode: (typeof DEFERRABLE_RELATION_CODES)[number];
};
export async function storeClaimRelations(
  c: PoolClient,
  ws: string,
  articleId: string,
  revision: number,
  publicationId: string,
  relations: ResolvedClaimRelation[],
  priorInPublication: Set<string> = new Set(),
  defer = false,
  dryRun = false,
  // Independent of `defer` (which only controls relation-only-failure
  // deferral): true whenever the caller is a machine producer (remote-worker
  // or consolidation-worker), never a user-initiated publish. Defaults to
  // `defer` because at the one call site where `defer` already means exactly
  // "this is the remote-worker automatic path" (knowledge-publish.ts), no
  // second argument is needed; consolidate.ts's two call sites pass this
  // explicitly since they always pass defer=false for unrelated reasons.
  automaticProducer = defer,
): Promise<{ deferred: DeferredRelation[] }> {
  const deferred: DeferredRelation[] = [];
  for (const relation of relations) {
    try {
      const from = (
        await c.query(
          "SELECT * FROM claims WHERE workspace_id=$1 AND article_id=$2 AND revision=$3 AND anchor=$4",
          [ws, articleId, revision, relation.anchor],
        )
      ).rows[0];
      const target = (
        await c.query(
          `SELECT cl.*,${effectiveClaimState("cl")} AS effective_state,r.publication_id,a.deleted_at,a.revision AS current_revision FROM claims cl JOIN revisions r USING(workspace_id,article_id,revision) JOIN articles a ON a.workspace_id=cl.workspace_id AND a.id=cl.article_id WHERE cl.workspace_id=$1 AND cl.article_id=$2 AND cl.revision=$3 AND cl.anchor=$4`,
          [
            ws,
            relation.target.articleId,
            relation.target.revision,
            relation.target.anchor,
          ],
        )
      ).rows[0];
      if (!from || !target || target.deleted_at)
        throw new AppError(400, "CLAIM_RELATION_TARGET_INVALID");
      // A claim cannot stand in any relation to itself. Nothing rejected this,
      // and a self-supersedes would pass every other gate and then make
      // effectiveClaimState retire the claim on its own authority.
      if (
        relation.target.articleId === articleId &&
        relation.target.revision === revision &&
        relation.target.anchor === relation.anchor
      )
        throw new AppError(400, "CLAIM_RELATION_SELF");
      if (
        ["supersedes", "retracts", "contradicts"].includes(
          relation.relation,
        ) &&
        target.revision !== target.current_revision &&
        !(
          relation.target.articleId === articleId &&
          target.revision === revision - 1
        )
      )
        throw new AppError(409, "CLAIM_TARGET_VERSION_CHANGED");
      // Same-batch references resolve only to an earlier change. Combined with
      // prior-publication references, this retains an acyclic version graph.
      if (
        target.publication_id === publicationId &&
        (!priorInPublication.has(relation.target.articleId) ||
          relation.target.articleId === articleId)
      )
        throw new AppError(400, "CLAIM_TARGET_NOT_PRIOR");
      if (
        !from.subject ||
        !from.scope ||
        from.subject !== target.subject ||
        from.scope !== target.scope
      )
        throw new AppError(400, "CLAIM_SCOPE_MISMATCH");
      if (
        ["supersedes", "retracts", "contradicts"].includes(
          relation.relation,
        ) &&
        target.type === "user_decision" &&
        from.type !== "user_decision"
      )
        throw new AppError(400, "DECISION_AUTHORITY_MISMATCH");
      if (
        ["supersedes", "retracts"].includes(relation.relation) &&
        from.state !== "current"
      )
        throw new AppError(400, "CLAIM_REPLACEMENT_NOT_CURRENT");
      if (
        ["supersedes", "retracts"].includes(relation.relation) &&
        ["superseded", "retracted"].includes(target.effective_state)
      )
        throw new AppError(409, "CLAIM_TARGET_ALREADY_RETIRED");
      // The machine must not silently overturn the user's own correction: an
      // automatic producer (remote-worker extraction, consolidation-worker)
      // may never supersede/retract a claim whose evidence traces back to a
      // feedback:* note source (registered by `claim retire`/`claim assert`).
      // A user-initiated publish (CLI `relation add`, `relation reject`, web
      // edit) is exempt — only the user may override their own decision.
      if (
        automaticProducer &&
        ["supersedes", "retracts"].includes(relation.relation)
      ) {
        const feedbackSourced = (
          await c.query(
            `SELECT 1 FROM evidence e JOIN sources s ON s.workspace_id=e.workspace_id AND s.id=e.source_id
             WHERE e.workspace_id=$1 AND e.article_id=$2 AND e.revision=$3 AND e.anchor=$4 AND s.origin LIKE 'feedback:%'`,
            [
              ws,
              relation.target.articleId,
              relation.target.revision,
              relation.target.anchor,
            ],
          )
        ).rowCount;
        if (feedbackSourced) throw new AppError(400, "FEEDBACK_REQUIRES_HUMAN");
      }
      // A replacement recorded earlier in time than what it replaces is
      // backward: something can only supersede what already existed. Only
      // 'recorded' times are trustworthy for ordering (docs/l2-l3-memory.md);
      // if either side has nothing but 'recovered' compaction times, skip.
      if (["supersedes", "retracts"].includes(relation.relation)) {
        const fromRecorded = (
          await claimEvidenceTimes(c, ws, articleId, revision, relation.anchor)
        ).filter((t) => t.time_kind === "recorded");
        const targetRecorded = (
          await claimEvidenceTimes(
            c,
            ws,
            relation.target.articleId,
            relation.target.revision,
            relation.target.anchor,
          )
        ).filter((t) => t.time_kind === "recorded");
        if (fromRecorded.length && targetRecorded.length) {
          const fromEarliest = Math.min(
            ...fromRecorded.map((t) => new Date(t.recorded_at).getTime()),
          );
          const targetLatest = Math.max(
            ...targetRecorded.map((t) => new Date(t.recorded_at).getTime()),
          );
          if (fromEarliest < targetLatest)
            throw new AppError(400, "SUPERSEDES_BACKWARD_IN_TIME");
        }
      }
      const citations = (
        await c.query(
          "SELECT source_id,source_revision,line_start,line_end,quote FROM evidence WHERE workspace_id=$1 AND article_id=$2 AND revision=$3 AND anchor=$4",
          [ws, articleId, revision, relation.anchor],
        )
      ).rows;
      if (
        !relation.evidence.every((e) =>
          citations.some(
            (v) =>
              v.source_id === e.sourceId &&
              v.source_revision === e.revision &&
              v.line_start === e.lines[0] &&
              v.line_end === e.lines[1] &&
              v.quote === e.quote,
          ),
        )
      )
        throw new AppError(400, "CLAIM_RELATION_EVIDENCE_REQUIRED");
      // Consolidation's validate Step reuses every check above without writing
      // (docs/l2-l3-memory.md#job과-step); the surviving relations are written
      // for real by its publish Step, which owns the publication row.
      if (!dryRun)
        await c.query(
          `INSERT INTO claim_relations(workspace_id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation,evidence,publication_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
          [
            ws,
            articleId,
            revision,
            relation.anchor,
            relation.target.articleId,
            relation.target.revision,
            relation.target.anchor,
            relation.relation,
            JSON.stringify(relation.evidence),
            publicationId,
          ],
        );
    } catch (e) {
      if (
        defer &&
        e instanceof AppError &&
        (DEFERRABLE_RELATION_CODES as readonly string[]).includes(e.code)
      ) {
        deferred.push({
          fromArticleId: articleId,
          fromRevision: revision,
          fromAnchor: relation.anchor,
          target: relation.target,
          relation: relation.relation,
          evidence: relation.evidence,
          errorCode: e.code as (typeof DEFERRABLE_RELATION_CODES)[number],
        });
        continue;
      }
      throw e;
    }
  }
  return { deferred };
}
export const effectiveClaimState = (alias: string) => `CASE
 WHEN EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=${alias}.workspace_id AND cr.to_article_id=${alias}.article_id AND cr.to_revision=${alias}.revision AND cr.to_anchor=${alias}.anchor AND cr.relation='retracts') THEN 'retracted'
 WHEN EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=${alias}.workspace_id AND cr.to_article_id=${alias}.article_id AND cr.to_revision=${alias}.revision AND cr.to_anchor=${alias}.anchor AND cr.relation='supersedes') THEN 'superseded'
 WHEN EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=${alias}.workspace_id AND ((cr.to_article_id=${alias}.article_id AND cr.to_revision=${alias}.revision AND cr.to_anchor=${alias}.anchor) OR (cr.from_article_id=${alias}.article_id AND cr.from_revision=${alias}.revision AND cr.from_anchor=${alias}.anchor)) AND cr.relation='contradicts'
   -- A contradiction whose other end the user already retired or replaced is
   -- settled, not open: the survivor must leave the conflict queue instead of
   -- staying flagged forever. Retired/replaced is decided by a relation on the
   -- other end, the same way this CASE decides it for the claim itself.
   AND NOT EXISTS(SELECT 1 FROM claim_relations done
     WHERE done.workspace_id=cr.workspace_id AND done.relation IN ('retracts','supersedes')
       AND ((done.to_article_id=cr.from_article_id AND done.to_revision=cr.from_revision AND done.to_anchor=cr.from_anchor
             AND NOT (cr.from_article_id=${alias}.article_id AND cr.from_revision=${alias}.revision AND cr.from_anchor=${alias}.anchor))
         OR (done.to_article_id=cr.to_article_id AND done.to_revision=cr.to_revision AND done.to_anchor=cr.to_anchor
             AND NOT (cr.to_article_id=${alias}.article_id AND cr.to_revision=${alias}.revision AND cr.to_anchor=${alias}.anchor))))
   -- Both ends must be adopted for the conflict to be the reader's problem.
   -- An unconfirmed agent statement disagreeing with a verified observation is
   -- not a contradiction in the knowledge, it is one assertion nobody has
   -- adopted; flagging the observation for it pushed a claim the user had
   -- confirmed out of the current list. Seen in production on a DeepSeek
   -- reasoning observation.
   AND EXISTS(SELECT 1 FROM claims other
     WHERE other.workspace_id=cr.workspace_id AND other.state='current'
       AND ((other.article_id=cr.from_article_id AND other.revision=cr.from_revision AND other.anchor=cr.from_anchor
             AND NOT (cr.from_article_id=${alias}.article_id AND cr.from_revision=${alias}.revision AND cr.from_anchor=${alias}.anchor))
         OR (other.article_id=cr.to_article_id AND other.revision=cr.to_revision AND other.anchor=cr.to_anchor
             AND NOT (cr.to_article_id=${alias}.article_id AND cr.to_revision=${alias}.revision AND cr.to_anchor=${alias}.anchor))))
   ) THEN 'conflicted'
 ELSE ${alias}.state END`;

// Retrieval follows explicit relations, never a similarity score, to find the
// current successor of an old matching decision. Traversal is bounded.
export async function expandClaimArticles(
  c: PoolClient,
  ws: string,
  initial: any[],
  history: boolean,
) {
  let all = initial.slice(0, 40),
    frontier = initial.slice(0, 20).map((a) => a.id),
    truncated = initial.length > 20;
  const seen = new Set(all.map((a) => a.id + ":" + a.revision));
  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    const rows = (
      await c.query(
        history
          ? `SELECT DISTINCT a.*,r.revision,r.title,r.content FROM claim_relations cr
      JOIN articles a ON a.workspace_id=cr.workspace_id AND (a.id=cr.from_article_id OR a.id=cr.to_article_id)
      JOIN revisions r ON r.workspace_id=a.workspace_id AND r.article_id=a.id AND
        ((a.id=cr.from_article_id AND r.revision=cr.from_revision) OR (a.id=cr.to_article_id AND r.revision=cr.to_revision))
      WHERE cr.workspace_id=$1 AND (cr.to_article_id=ANY($2::uuid[]) OR cr.from_article_id=ANY($2::uuid[]))
      AND a.deleted_at IS NULL ORDER BY a.updated_at DESC,a.id,r.revision DESC LIMIT 41`
          : `SELECT DISTINCT a.* FROM claim_relations cr
      JOIN articles a ON a.workspace_id=cr.workspace_id AND a.id=cr.from_article_id
      WHERE cr.workspace_id=$1 AND cr.to_article_id=ANY($2::uuid[])
      AND a.deleted_at IS NULL ORDER BY a.updated_at DESC,a.id LIMIT 41`,
        [ws, frontier],
      )
    ).rows;
    if (rows.length > 40) truncated = true;
    const added = rows
      .slice(0, 40)
      .filter((a) => !seen.has(a.id + ":" + a.revision));
    added.forEach((a) => seen.add(a.id + ":" + a.revision));
    all = [...added, ...all];
    frontier = added.map((a) => a.id);
    if (all.length > 40) {
      all = all.slice(0, 40);
      truncated = true;
      break;
    }
    if (depth === 7 && frontier.length) truncated = true;
  }
  return { items: all, truncated };
}
export function claimText(claims: any[]) {
  const labels: Record<string, string> = {
    proposed: "검토 의견",
    superseded: "대체됨",
    retracted: "철회됨",
    conflicted: "미해결 충돌",
    unconfirmed: "미확인",
  };
  return claims
    .map(
      (c) =>
        (c.state !== "current"
          ? "[" + (labels[c.state] ?? c.state) + "] "
          : "") + c.text,
    )
    .join("\n\n");
}
