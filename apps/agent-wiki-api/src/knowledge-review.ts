import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, requireRow } from "../../../packages/core/src/db.js";
import { hash } from "../../../packages/core/src/storage.js";
import { effectiveClaimState } from "./claim-relations.js";
import { pagination, paged } from "./pagination.js";

function stable(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function knowledgeSnapshot(
  c: PoolClient,
  ws: string,
  id: string,
  revision?: number,
) {
  const article = requireRow(
    (
      await c.query(
        "SELECT a.id,a.revision AS current_revision,r.revision,r.title,r.metadata FROM articles a JOIN revisions r ON r.workspace_id=a.workspace_id AND r.article_id=a.id AND r.revision=COALESCE($3,a.revision) WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL",
        [ws, id, revision ?? null],
      )
    ).rows[0],
  );
  const claims = (
    await c.query(
      `SELECT cl.anchor,cl.text,cl.type,cl.subject,cl.scope,${effectiveClaimState("cl")} AS state FROM claims cl WHERE workspace_id=$1 AND article_id=$2 AND revision=$3 ORDER BY anchor`,
      [ws, id, article.revision],
    )
  ).rows;
  const evidence = (
    await c.query(
      "SELECT anchor,source_id,source_revision,line_start,line_end FROM evidence WHERE workspace_id=$1 AND article_id=$2 AND revision=$3 ORDER BY anchor,source_id,line_start,line_end",
      [ws, id, article.revision],
    )
  ).rows;
  const relations = (
    await c.query(
      "SELECT from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation FROM claim_relations WHERE workspace_id=$1 AND ((from_article_id=$2 AND from_revision=$3) OR (to_article_id=$2 AND to_revision=$3)) ORDER BY from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation",
      [ws, id, article.revision],
    )
  ).rows;
  const snapshot = {
    title: article.title,
    metadata: article.metadata,
    claims: claims.map((cl) => ({
      ...cl,
      evidence: evidence
        .filter((e) => e.anchor === cl.anchor)
        .map(({ anchor, ...e }) => e),
    })),
    relations,
  };
  return {
    articleId: id,
    revision: article.revision,
    currentRevision: article.current_revision,
    snapshot,
    snapshotHash: hash(stable(snapshot)),
  };
}
// Stable claim anchors are primary. Unique subject/scope is an explicit fallback
// for an anchor rename, not a semantic merge or an LLM judgement.
export function compareConcepts(before: any, after: any) {
  const prior: any[] = before?.claims ?? [],
    next: any[] = after.claims,
    used = new Set<number>();
  const changes: any[] = [];
  for (const claim of next) {
    let index = prior.findIndex(
        (p, i) => !used.has(i) && p.anchor === claim.anchor,
      ),
      matchedBy = "anchor";
    if (index < 0 && claim.subject && claim.scope) {
      const matches = prior
        .map((p, i) => ({ p, i }))
        .filter(
          ({ p, i }) =>
            !used.has(i) &&
            p.subject === claim.subject &&
            p.scope === claim.scope,
        );
      if (
        matches.length === 1 &&
        next.filter(
          (p) => p.subject === claim.subject && p.scope === claim.scope,
        ).length === 1
      ) {
        index = matches[0].i;
        matchedBy = "subject_scope";
      }
    }
    if (index < 0) {
      changes.push({ kind: "added", after: claim });
      continue;
    }
    used.add(index);
    const previous = prior[index];
    const fields = [
      "text",
      "type",
      "subject",
      "scope",
      "state",
      "evidence",
    ].filter((k) => stable(previous[k]) !== stable(claim[k]));
    if (fields.length)
      changes.push({
        kind: "changed",
        matchedBy,
        fields,
        before: previous,
        after: claim,
      });
  }
  prior.forEach((claim, i) => {
    if (!used.has(i)) changes.push({ kind: "removed", before: claim });
  });
  const oldRelations = before?.relations ?? [],
    newRelations = after.relations;
  const difference = (a: any[], b: any[]) =>
    a.filter((x) => !b.some((y) => stable(x) === stable(y)));
  return {
    claims: changes,
    relations: {
      added: difference(newRelations, oldRelations),
      removed: difference(oldRelations, newRelations),
    },
    metadataChanged:
      !before ||
      stable([before.title, before.metadata]) !==
        stable([after.title, after.metadata]),
  };
}
export async function reviewComparison(
  c: PoolClient,
  ws: string,
  id: string,
  revision?: number,
) {
  const target = await knowledgeSnapshot(c, ws, id, revision);
  const reviewed = (
    await c.query(
      "SELECT id,revision,snapshot,snapshot_hash,created_at,reviewer FROM knowledge_reviews WHERE workspace_id=$1 AND article_id=$2 AND revision<=$3 ORDER BY revision DESC,created_at DESC,id DESC LIMIT 1",
      [ws, id, target.revision],
    )
  ).rows[0];
  const prior = reviewed
    ? null
    : target.revision > 1
      ? await knowledgeSnapshot(c, ws, id, target.revision - 1)
      : null;
  return {
    articleId: id,
    revision: target.revision,
    currentRevision: target.currentRevision,
    snapshotHash: target.snapshotHash,
    reviewPending:
      !reviewed ||
      reviewed.revision !== target.revision ||
      reviewed.snapshot_hash !== target.snapshotHash,
    baseline: reviewed
      ? {
          kind: "reviewed",
          revision: reviewed.revision,
          reviewId: reviewed.id,
          reviewedAt: reviewed.created_at,
        }
      : prior
        ? { kind: "previous", revision: prior.revision }
        : { kind: "empty", revision: null },
    changes: compareConcepts(
      reviewed?.snapshot ?? prior?.snapshot,
      target.snapshot,
    ),
  };
}
export async function confirmReview(
  c: PoolClient,
  ws: string,
  id: string,
  raw: unknown,
  actorId: string,
) {
  const input = z
    .object({
      revision: z.number().int().positive(),
      snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
      client: z.string().min(1).max(100),
      reason: z.string().max(2000).default(""),
    })
    .strict()
    .parse(raw);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [ws]);
  const target = await knowledgeSnapshot(c, ws, id);
  if (target.revision !== input.revision)
    throw new AppError(409, "REVISION_CONFLICT");
  if (target.snapshotHash !== input.snapshotHash)
    throw new AppError(409, "REVIEW_COMPARISON_CHANGED");
  const result = (
    await c.query(
      "INSERT INTO knowledge_reviews(id,workspace_id,article_id,revision,snapshot,snapshot_hash,reviewer,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,article_id,revision,snapshot_hash) DO UPDATE SET snapshot_hash=EXCLUDED.snapshot_hash RETURNING id,revision,created_at",
      [
        randomUUID(),
        ws,
        id,
        target.revision,
        JSON.stringify(target.snapshot),
        target.snapshotHash,
        JSON.stringify({ actorId, client: input.client }),
        input.reason,
      ],
    )
  ).rows[0];
  await c.query(
    "UPDATE revisions SET reviewed_at=$4,reviewed_by=$5 WHERE workspace_id=$1 AND article_id=$2 AND revision=$3",
    [ws, id, target.revision, result.created_at, actorId],
  );
  return {
    ok: true,
    reviewId: result.id,
    revision: result.revision,
    reviewedAt: result.created_at,
  };
}
export const reviewPendingSql = (a = "a", r = "r") =>
  `(${r}.reviewed_at IS NULL OR NOT EXISTS(SELECT 1 FROM knowledge_reviews kr WHERE kr.workspace_id=${a}.workspace_id AND kr.article_id=${a}.id AND kr.revision=${a}.revision) OR EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=${a}.workspace_id AND ((cr.from_article_id=${a}.id AND cr.from_revision=${a}.revision) OR (cr.to_article_id=${a}.id AND cr.to_revision=${a}.revision)) AND cr.created_at>${r}.reviewed_at))`;
export async function pendingReviews(c: PoolClient, ws: string, raw: unknown) {
  const page = pagination(raw);
  const rows = (
    await c.query(
      `SELECT a.id,a.title,a.revision,a.updated_at,r.reviewed_at FROM articles a JOIN revisions r ON r.workspace_id=a.workspace_id AND r.article_id=a.id AND r.revision=a.revision WHERE a.workspace_id=$1 AND a.deleted_at IS NULL AND ${reviewPendingSql()} ORDER BY a.updated_at,a.id LIMIT $2 OFFSET $3`,
      [ws, page.size + 1, page.offset],
    )
  ).rows;
  return paged(rows, page);
}
