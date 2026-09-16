import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, requireRow } from "../../../packages/core/src/db.js";
import { publish } from "./knowledge-publish.js";
import { effectiveClaimState } from "./claim-relations.js";
import { refreshWikiPages } from "./wiki-pages.js";
import { small, type ChangeInput } from "./publication-schema.js";
// Reverses an auto-applied (or any) relation via a corrective Version of
// whichever claim(s) the relation's effective state depended on — never a
// delete. docs/l2-l3-memory.md#relation-reject--자동-반영을-되돌리는-명령.
const claimRef = z
  .object({
    articleId: z.string().uuid(),
    revision: z.number().int().positive(),
    anchor: z.string().regex(/^[\w-]{1,80}$/),
  })
  .strict();
export const rejectRelationInput = z
  .object({
    from: claimRef,
    to: claimRef,
    relation: z.enum(["supersedes", "retracts", "contradicts", "supports"]),
    client: small,
    reason: z.string().min(1).max(2000),
  })
  .strict();
export type RejectRelationInput = z.infer<typeof rejectRelationInput>;

// Exported for claim-relation-add.ts, which reuses this exact "republish the
// article's current claims verbatim" step to attach a brand-new relation to
// an existing claim (no relation-authoring endpoint existed before either).
export async function republishChange(
  c: PoolClient,
  ws: string,
  articleId: string,
): Promise<ChangeInput> {
  const article = requireRow(
    (
      await c.query(
        "SELECT * FROM articles WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
        [ws, articleId],
      )
    ).rows[0],
  );
  // Carry the effective state, not the stored one. Relations point at a fixed
  // (article, revision, anchor) and are not copied onto the new Version, so a
  // sibling that a relation had superseded would come back as raw 'current'
  // here — a corrective Version would silently resurrect what the user or
  // Consolidation had already retired. knowledge-publish's consolidateClaim
  // already reads effective_state for the same reason.
  const claims = (
    await c.query(
      `SELECT cl.*,${effectiveClaimState("cl")} AS effective_state FROM claims cl WHERE cl.workspace_id=$1 AND cl.article_id=$2 AND cl.revision=$3 ORDER BY cl.anchor`,
      [ws, articleId, article.revision],
    )
  ).rows;
  const evidence = (
    await c.query(
      "SELECT * FROM evidence WHERE workspace_id=$1 AND article_id=$2 AND revision=$3",
      [ws, articleId, article.revision],
    )
  ).rows;
  return {
    clientRef: articleId,
    articleId,
    baseRevision: article.revision,
    title: article.title,
    content: article.content,
    kind: article.kind,
    folder: article.folder,
    tags: article.tags,
    aliases: article.aliases,
    links: [],
    supersedes: [],
    claimRelations: [],
    claims: claims.map((claim) => ({
      anchor: claim.anchor,
      text: claim.text,
      type: claim.type,
      subject: claim.subject,
      scope: claim.scope,
      state: claim.effective_state,
      evidence: evidence
        .filter((e) => e.anchor === claim.anchor)
        .map((e) => ({
          sourceId: e.source_id,
          revision: e.source_revision,
          lines: [e.line_start, e.line_end] as [number, number],
          quote: e.quote,
        })),
    })),
  };
}
export async function rejectClaimRelation(
  c: PoolClient,
  ws: string,
  raw: unknown,
  identity: { userId: string; scope?: string },
) {
  const input = rejectRelationInput.parse(raw);
  const exists = (
    await c.query(
      `SELECT 1 FROM claim_relations WHERE workspace_id=$1 AND from_article_id=$2 AND from_revision=$3 AND from_anchor=$4 AND to_article_id=$5 AND to_revision=$6 AND to_anchor=$7 AND relation=$8`,
      [
        ws,
        input.from.articleId,
        input.from.revision,
        input.from.anchor,
        input.to.articleId,
        input.to.revision,
        input.to.anchor,
        input.relation,
      ],
    )
  ).rowCount;
  if (!exists) throw new AppError(404, "CLAIM_RELATION_NOT_FOUND");
  const already = (
    await c.query(
      `SELECT 1 FROM claim_relation_rejections WHERE workspace_id=$1 AND from_article_id=$2 AND from_revision=$3 AND from_anchor=$4 AND to_article_id=$5 AND to_revision=$6 AND to_anchor=$7 AND relation=$8`,
      [
        ws,
        input.from.articleId,
        input.from.revision,
        input.from.anchor,
        input.to.articleId,
        input.to.revision,
        input.to.anchor,
        input.relation,
      ],
    )
  ).rowCount;
  if (already) throw new AppError(409, "CLAIM_RELATION_ALREADY_REJECTED");
  // supersedes/retracts only changed the target's state; contradicts changed
  // both ends'; supports never changed a state, so nothing to correct.
  const targets =
    input.relation === "contradicts"
      ? [input.from, input.to]
      : ["supersedes", "retracts"].includes(input.relation)
        ? [input.to]
        : [];
  for (const ref of targets) {
    const article = requireRow(
      (
        await c.query(
          "SELECT revision FROM articles WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
          [ws, ref.articleId],
        )
      ).rows[0],
    );
    // A later, unrelated Version already exists on this article; a corrective
    // Version based on the relation's own target Version is no longer valid.
    if (article.revision !== ref.revision)
      throw new AppError(409, "RELATION_TARGET_NOT_CURRENT");
  }
  let publicationId: string | null = null;
  if (targets.length) {
    const changes = await Promise.all(
      targets.map((ref) => republishChange(c, ws, ref.articleId)),
    );
    const scope = identity.scope ?? "manage";
    const result = await publish(
      c,
      ws,
      {
        idempotencyKey: "relation-reject-" + randomUUID(),
        // Matches the /articles human-edit convention: a "manage"-scoped
        // caller (CLI, possibly run by an agent) publishes as agent; a
        // session-scoped caller (the web UI) publishes as human.
        producer: {
          type: scope === "session" ? "human" : "agent",
          client: input.client,
        },
        reason: "관계 거부 · " + input.reason,
        changes,
      },
      { userId: identity.userId, scope },
    );
    publicationId = result.id;
  } else {
    await refreshWikiPages(c, ws);
  }
  await c.query(
    `INSERT INTO claim_relation_rejections(workspace_id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation,reason,publication_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      ws,
      input.from.articleId,
      input.from.revision,
      input.from.anchor,
      input.to.articleId,
      input.to.revision,
      input.to.anchor,
      input.relation,
      input.reason,
      publicationId,
    ],
  );
  return { ok: true, publicationId };
}
