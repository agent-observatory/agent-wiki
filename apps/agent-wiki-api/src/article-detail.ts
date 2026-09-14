import type { PoolClient } from "pg";
import { z } from "zod";
import { requireRow } from "../../../packages/core/src/db.js";
import { searchPatterns } from "../../../packages/core/src/search-terms.js";
import { reviewComparison, reviewPendingSql } from "./knowledge-review.js";
import { effectiveClaimState } from "./claim-relations.js";
import { pagination, paged } from "./pagination.js";
export type ArticleDetail = Awaited<ReturnType<typeof detail>>;
export async function detail(
  c: PoolClient,
  ws: string,
  id: string,
  revision?: number,
) {
  const a = requireRow(
    (
      await c.query(
        "SELECT * FROM articles WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
        [ws, id],
      )
    ).rows[0],
  );
  const rev = requireRow(
    (
      await c.query(
        "SELECT r.*,p.producer,p.reason,p.created_at AS refined_at FROM revisions r JOIN publications p ON p.id=r.publication_id AND p.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.article_id=$2 AND r.revision=$3",
        [ws, id, revision ?? a.revision],
      )
    ).rows[0],
  );
  const claims = (
    await c.query(
      `SELECT cl.*,${effectiveClaimState("cl")} AS state FROM claims cl WHERE workspace_id=$1 AND article_id=$2 AND revision=$3 ORDER BY anchor`,
      [ws, id, rev.revision],
    )
  ).rows;
  const evidence = (
    await c.query(
      "SELECT e.*,s.name,s.origin,s.content_hash,s.deleted_at IS NOT NULL AS unavailable FROM evidence e JOIN sources s ON s.id=e.source_id AND s.workspace_id=e.workspace_id WHERE e.workspace_id=$1 AND e.article_id=$2 AND e.revision=$3 ORDER BY e.anchor,e.source_id,e.line_start",
      [ws, id, rev.revision],
    )
  ).rows;
  const storedLinks = rev.metadata.resolvedLinks ?? [];
  const links = storedLinks.length
    ? (
        await c.query(
          "SELECT a.id,a.title,x.relation FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,relation text) JOIN articles a ON a.id=x.id AND a.workspace_id=$1 WHERE a.deleted_at IS NULL",
          [ws, JSON.stringify(storedLinks)],
        )
      ).rows
    : [];
  const supersededBy = (
    await c.query(
      "SELECT a.id,a.title FROM links l JOIN articles a ON a.id=l.from_id AND a.workspace_id=l.workspace_id WHERE l.workspace_id=$1 AND l.to_id=$2 AND l.relation='supersedes' AND a.deleted_at IS NULL",
      [ws, id],
    )
  ).rows;
  return {
    ...a,
    ...rev,
    ...rev.metadata,
    id,
    title: rev.title,
    content: rev.content,
    currentRevision: a.revision,
    reviewPending: (await reviewComparison(c, ws, id, rev.revision))
      .reviewPending,
    claims: claims.map((x) => ({
      ...x,
      evidence: evidence.filter((e) => e.anchor === x.anchor),
    })),
    links,
    claimRelations: (
      await c.query(
        "SELECT * FROM claim_relations WHERE workspace_id=$1 AND ((from_article_id=$2 AND from_revision=$3) OR (to_article_id=$2 AND to_revision=$3)) ORDER BY created_at",
        [ws, id, rev.revision],
      )
    ).rows,
    supersededBy,
    revisions: (
      await c.query(
        "SELECT revision,title,created_at FROM revisions WHERE workspace_id=$1 AND article_id=$2 ORDER BY revision DESC",
        [ws, id],
      )
    ).rows,
  };
}
export async function search(c: PoolClient, ws: string, raw: unknown) {
  const page = pagination(raw);
  const q = z
    .object({
      q: z.string().max(200).default(""),
      tag: z.string().max(40).optional(),
      folder: z.string().max(120).optional(),
      kind: z.enum(["article", "memory", "glossary"]).optional(),
      includeSuperseded: z.enum(["true", "false"]).default("false"),
    })
    .parse(raw);
  const terms = searchPatterns(q.q);
  const queryStatus = !q.q.trim()
    ? "browse"
    : terms.length
      ? "ready"
      : "needs_terms";
  if (queryStatus === "needs_terms")
    return { ...paged<any>([], page), query: q.q, queryStatus };
  const rows = (
    await c.query(
      `WITH query_terms AS (
        SELECT ARRAY(SELECT jsonb_array_elements_text(value)) AS patterns
        FROM jsonb_array_elements($2::jsonb)
      )
      SELECT a.*,r.reviewed_at,${reviewPendingSql()} AS "reviewPending",p.producer,
        (SELECT count(*) FROM evidence e WHERE e.workspace_id=a.workspace_id AND e.article_id=a.id AND e.revision=a.revision) AS evidence_count
      FROM articles a
      JOIN revisions r ON r.workspace_id=a.workspace_id AND r.article_id=a.id AND r.revision=a.revision
      JOIN publications p ON p.workspace_id=r.workspace_id AND p.id=r.publication_id
      CROSS JOIN LATERAL (
        SELECT count(*) FILTER(WHERE weight>0) AS coverage,COALESCE(sum(weight),0) AS score
        FROM (SELECT CASE
          WHEN a.title ILIKE ANY(t.patterns) THEN 4
          WHEN array_to_string(a.tags||a.aliases,' ') ILIKE ANY(t.patterns) THEN 3
          WHEN a.content ILIKE ANY(t.patterns) THEN 1
          WHEN EXISTS(SELECT 1 FROM articles g WHERE g.workspace_id=$1 AND g.deleted_at IS NULL AND g.kind='glossary'
            AND array_to_string(g.aliases,' ') ILIKE ANY(t.patterns)
            AND position(lower(g.title) in lower(a.title||' '||a.content))>0) THEN 1
          ELSE 0 END AS weight FROM query_terms t) hits
      ) relevance
      WHERE a.workspace_id=$1 AND a.deleted_at IS NULL
        AND ($3::text IS NULL OR $3=ANY(a.tags))
        AND ($4::text IS NULL OR a.folder=$4)
        AND ($5::text IS NULL OR a.kind=$5)
        AND ($6 OR NOT EXISTS(SELECT 1 FROM links l JOIN articles newer ON newer.id=l.from_id AND newer.workspace_id=l.workspace_id
          WHERE l.workspace_id=a.workspace_id AND l.to_id=a.id AND l.relation='supersedes' AND newer.deleted_at IS NULL))
        AND (NOT EXISTS(SELECT 1 FROM query_terms) OR relevance.coverage>0)
      ORDER BY relevance.coverage DESC,relevance.score DESC,a.updated_at DESC,a.id LIMIT $7 OFFSET $8`,
      [
        ws,
        JSON.stringify(terms),
        q.tag ?? null,
        q.folder ?? null,
        q.kind ?? null,
        q.includeSuperseded === "true",
        page.size + 1,
        page.offset,
      ],
    )
  ).rows;
  return { ...paged(rows, page), query: q.q, queryStatus };
}
