import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { hash } from "../../../packages/core/src/storage.js";
import { renderWikiPage } from "../../../packages/core/src/wiki-page.js";
import { effectiveClaimState } from "./claim-relations.js";
import { AppError } from "../../../packages/core/src/db.js";
import { pagination, paged } from "./pagination.js";

// Caller holds the workspace publication lock. Rebuild only changed snapshots;
// no source downloads and no second model call. Claims remain the source of truth.
export async function refreshWikiPages(c: PoolClient, ws: string) {
  const topics = (
    await c.query(
      "SELECT DISTINCT topic_key,topic_title FROM articles WHERE workspace_id=$1 AND deleted_at IS NULL AND topic_key<>'' ORDER BY topic_key,topic_title",
      [ws],
    )
  ).rows;
  const seen = new Set<string>();
  for (const topic of topics) {
    if (seen.has(topic.topic_key)) continue;
    seen.add(topic.topic_key);
    const old = (
      await c.query(
        "SELECT * FROM wiki_pages WHERE workspace_id=$1 AND topic_key=$2",
        [ws, topic.topic_key],
      )
    ).rows[0];
    const title = old?.title ?? topic.topic_title;
    const claims = (
      await c.query(
        `SELECT cl.*,a.title,${effectiveClaimState("cl")} AS state,
        COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('at',t.recorded_at,'kind',t.time_kind)) FROM evidence e JOIN source_record_times t ON t.workspace_id=e.workspace_id AND t.source_id=e.source_id AND t.line=e.line_start WHERE e.workspace_id=cl.workspace_id AND e.article_id=cl.article_id AND e.revision=cl.revision AND e.anchor=cl.anchor),'[]'::jsonb) AS evidence_times FROM claims cl JOIN articles a ON a.workspace_id=cl.workspace_id AND a.id=cl.article_id
      WHERE a.workspace_id=$1 AND a.deleted_at IS NULL AND a.topic_key=$2 AND
      (cl.revision=a.revision OR EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=$1 AND cr.to_article_id=cl.article_id AND cr.to_revision=cl.revision AND cr.to_anchor=cl.anchor AND cr.relation IN ('supersedes','retracts','contradicts')))
      ORDER BY a.created_at,a.id,cl.revision,cl.anchor`,
        [ws, topic.topic_key],
      )
    ).rows;
    for (const claim of claims)
      claim.evidence_times.sort(
        (a: any, b: any) =>
          String(a.at).localeCompare(String(b.at)) ||
          String(a.kind).localeCompare(String(b.kind)),
      );
    const relations = (
      await c.query(
        `SELECT cr.* FROM claim_relations cr JOIN articles a ON a.workspace_id=cr.workspace_id AND a.id=cr.from_article_id WHERE cr.workspace_id=$1 AND a.topic_key=$2 AND a.deleted_at IS NULL ORDER BY cr.created_at,cr.from_article_id,cr.from_anchor,cr.from_revision,cr.to_article_id,cr.to_revision,cr.to_anchor,cr.relation`,
        [ws, topic.topic_key],
      )
    ).rows;
    const references = (
      await c.query(
        `SELECT cl.*,a.title FROM claims cl JOIN articles a ON a.workspace_id=cl.workspace_id AND a.id=cl.article_id WHERE cl.workspace_id=$1 AND a.id=ANY($2::uuid[]) ORDER BY cl.article_id,cl.revision,cl.anchor`,
        [
          ws,
          [
            ...new Set(
              relations.flatMap((r) => [r.from_article_id, r.to_article_id]),
            ),
          ],
        ],
      )
    ).rows;
    const tags = (
      await c.query(
        "SELECT DISTINCT unnest(tags) AS tag FROM articles WHERE workspace_id=$1 AND topic_key=$2 AND deleted_at IS NULL ORDER BY tag",
        [ws, topic.topic_key],
      )
    ).rows.map((r) => r.tag);
    const content = renderWikiPage(
      title,
      claims,
      relations,
      `/workspaces/${ws}/knowledge`,
      references,
    );
    const snapshot = {
      assemblyVersion: "topic-sections-2",
      claims,
      relations,
      references,
      tags,
    };
    const fingerprint = hash(JSON.stringify({ title, content, snapshot }));
    if (old?.input_hash === fingerprint) continue;
    const id = old?.id ?? randomUUID(),
      revision = (old?.revision ?? 0) + 1;
    await c.query(
      `INSERT INTO wiki_pages(workspace_id,id,topic_key,title,content,revision,input_hash,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(workspace_id,topic_key) DO UPDATE SET title=$4,content=$5,revision=$6,input_hash=$7,tags=$8,updated_at=now()`,
      [ws, id, topic.topic_key, title, content, revision, fingerprint, tags],
    );
    await c.query(
      "INSERT INTO wiki_page_versions(workspace_id,page_id,revision,title,content,snapshot,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [ws, id, revision, title, content, JSON.stringify(snapshot), fingerprint],
    );
  }
  await c.query(
    "DELETE FROM wiki_page_versions v WHERE workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM wiki_pages p JOIN articles a ON a.workspace_id=p.workspace_id AND a.topic_key=p.topic_key AND a.deleted_at IS NULL WHERE p.workspace_id=v.workspace_id AND p.id=v.page_id)",
    [ws],
  );
  await c.query(
    "DELETE FROM wiki_pages p WHERE workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM articles a WHERE a.workspace_id=p.workspace_id AND a.topic_key=p.topic_key AND a.deleted_at IS NULL)",
    [ws],
  );
}
export async function listWikiPages(c: PoolClient, ws: string, query: any) {
  const page = pagination(query),
    q = String(query?.q ?? "").slice(0, 200),
    tag = String(query?.tag ?? "");
  const rows = (
    await c.query(
      `SELECT p.*,jsonb_array_length(v.snapshot->'claims') AS claim_count FROM wiki_pages p JOIN wiki_page_versions v ON v.workspace_id=p.workspace_id AND v.page_id=p.id AND v.revision=p.revision
    WHERE p.workspace_id=$1 AND ($2='' OR position(lower($2) in lower(p.title||' '||p.content))>0) AND ($3='' OR $3=ANY(p.tags)) ORDER BY p.updated_at DESC,p.id LIMIT $4 OFFSET $5`,
      [ws, q, tag, page.size + 1, page.offset],
    )
  ).rows;
  return {
    ...paged(rows, page),
    query: q,
    queryStatus: q ? "ready" : "browse",
  };
}
export async function wikiPageDetail(
  c: PoolClient,
  ws: string,
  id: string,
  revision?: number,
) {
  const row = (
    await c.query(
      `SELECT p.id,p.topic_key,p.revision AS "currentRevision",p.tags,v.* FROM wiki_pages p JOIN wiki_page_versions v ON v.workspace_id=p.workspace_id AND v.page_id=p.id AND v.revision=COALESCE($3,p.revision) WHERE p.workspace_id=$1 AND p.id=$2`,
      [ws, id, revision ?? null],
    )
  ).rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND");
  return {
    ...row,
    hasUnprocessedSources: !!(
      await c.query(
        "SELECT 1 FROM refinement_jobs WHERE workspace_id=$1 AND status<>'completed' LIMIT 1",
        [ws],
      )
    ).rowCount,
    revisions: (
      await c.query(
        "SELECT revision,created_at FROM wiki_page_versions WHERE workspace_id=$1 AND page_id=$2 ORDER BY revision DESC",
        [ws, id],
      )
    ).rows,
  };
}
