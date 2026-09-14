import type { PoolClient } from "pg";
import {
  rankQueryDocuments,
  uncoveredTermGroups,
  QUERY_POLICY,
} from "../../../packages/core/src/query-ranking.js";
import { searchTermGroups } from "../../../packages/core/src/search-terms.js";
export async function queryCandidates(
  c: PoolClient,
  ws: string,
  q: string,
  tag?: string,
  folder?: string,
  kind?: string,
) {
  // Bounded personal-workspace corpus; report truncation instead of pretending
  // this is a complete search when the product grows beyond the current limit.
  const rows = (
    await c.query(
      `SELECT id,revision,kind,folder,title,left(content,12000) content,tags,aliases,topic_key,topic_title,updated_at,length(content)>12000 AS content_truncated
    FROM articles WHERE workspace_id=$1 AND deleted_at IS NULL
    AND ($2::text IS NULL OR $2=ANY(tags)) AND ($3::text IS NULL OR folder=$3) AND ($4::text IS NULL OR kind=$4)
    ORDER BY updated_at DESC,id LIMIT 2001`,
      [ws, tag ?? null, folder ?? null, kind ?? null],
    )
  ).rows;
  const docs = rows.slice(0, 2000);
  // Expand registered glossary aliases before scoring. No model call.
  const glossaries = (
    await c.query(
      "SELECT title,aliases FROM articles WHERE workspace_id=$1 AND deleted_at IS NULL AND kind='glossary' ORDER BY id LIMIT 200",
      [ws],
    )
  ).rows;
  const groups = searchTermGroups(q);
  const aliases = glossaries
    .filter((g) =>
      groups.some((group) =>
        group.some((t) =>
          [g.title, ...g.aliases].join(" ").toLowerCase().includes(t),
        ),
      ),
    )
    .map((g) => g.title);
  const hits = q.trim()
    ? rankQueryDocuments(docs, [q, ...aliases].join(" "))
    : docs.map((document) => ({ document, score: 0, matched: [] }));
  return {
    items: hits.map((h) => ({
      ...h.document,
      relevance: h.score,
      matchedTerms: h.matched,
    })),
    policy: QUERY_POLICY,
    // Original query terms absent from every candidate document.
    unmatchedTerms: q.trim() ? uncoveredTermGroups(docs, q) : [],
    corpusSize: docs.length,
    truncated: rows.length > 2000 || docs.some((x) => x.content_truncated),
  };
}
