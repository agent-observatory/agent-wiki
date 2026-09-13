import type { PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../../../packages/core/src/db.js";

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
export async function storeClaimRelations(
  c: PoolClient,
  ws: string,
  articleId: string,
  revision: number,
  publicationId: string,
  relations: ResolvedClaimRelation[],
  priorInPublication: Set<string> = new Set(),
) {
  for (const relation of relations) {
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
    if (
      ["supersedes", "retracts", "contradicts"].includes(relation.relation) &&
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
      ["supersedes", "retracts", "contradicts"].includes(relation.relation) &&
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
  }
}
export const effectiveClaimState = (alias: string) => `CASE
 WHEN EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=${alias}.workspace_id AND cr.to_article_id=${alias}.article_id AND cr.to_revision=${alias}.revision AND cr.to_anchor=${alias}.anchor AND cr.relation='retracts') THEN 'retracted'
 WHEN EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=${alias}.workspace_id AND cr.to_article_id=${alias}.article_id AND cr.to_revision=${alias}.revision AND cr.to_anchor=${alias}.anchor AND cr.relation='supersedes') THEN 'superseded'
 WHEN EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=${alias}.workspace_id AND ((cr.to_article_id=${alias}.article_id AND cr.to_revision=${alias}.revision AND cr.to_anchor=${alias}.anchor) OR (cr.from_article_id=${alias}.article_id AND cr.from_revision=${alias}.revision AND cr.from_anchor=${alias}.anchor)) AND cr.relation='contradicts') THEN 'conflicted'
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
