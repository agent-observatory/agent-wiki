import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { hash } from "../../../packages/core/src/storage.js";
import {
  renderWikiPage,
  supportClusters,
  claimKey,
} from "../../../packages/core/src/wiki-page.js";
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
        COALESCE(et.times,'[]'::jsonb) AS evidence_times,
        et.first_evidence_at,et.first_evidence_kind,
        COALESCE(ev.refs,'[]'::jsonb) AS evidence
        FROM claims cl JOIN articles a ON a.workspace_id=cl.workspace_id AND a.id=cl.article_id
        LEFT JOIN LATERAL (
          SELECT
            jsonb_agg(DISTINCT jsonb_build_object('at',t.recorded_at,'kind',t.time_kind)) AS times,
            (array_agg(t.recorded_at ORDER BY t.recorded_at,s.created_at,e.line_start))[1] AS first_evidence_at,
            (array_agg(t.time_kind ORDER BY t.recorded_at,s.created_at,e.line_start))[1] AS first_evidence_kind,
            (array_agg(s.created_at ORDER BY t.recorded_at,s.created_at,e.line_start))[1] AS sort_source_created_at,
            (array_agg(e.line_start ORDER BY t.recorded_at,s.created_at,e.line_start))[1] AS sort_line_start
          FROM evidence e
          JOIN source_record_times t ON t.workspace_id=e.workspace_id AND t.source_id=e.source_id AND t.line=e.line_start
          JOIN sources s ON s.workspace_id=e.workspace_id AND s.id=e.source_id
          WHERE e.workspace_id=cl.workspace_id AND e.article_id=cl.article_id AND e.revision=cl.revision AND e.anchor=cl.anchor
        ) et ON true
        -- Separate from the time lateral above: that one inner-joins
        -- source_record_times, so a claim whose evidence has no recorded time
        -- would show zero. The count on screen must be the real one.
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object('sourceId',e.source_id,'lines',jsonb_build_array(e.line_start,e.line_end))
                           ORDER BY e.source_id,e.line_start) AS refs
          FROM evidence e
          WHERE e.workspace_id=cl.workspace_id AND e.article_id=cl.article_id AND e.revision=cl.revision AND e.anchor=cl.anchor
        ) ev ON true
      WHERE a.workspace_id=$1 AND a.deleted_at IS NULL AND a.topic_key=$2 AND
      (cl.revision=a.revision OR EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=$1 AND cr.to_article_id=cl.article_id AND cr.to_revision=cl.revision AND cr.to_anchor=cl.anchor AND cr.relation IN ('supersedes','retracts','contradicts')))
      ORDER BY et.first_evidence_at NULLS LAST,et.sort_source_created_at NULLS LAST,et.sort_line_start NULLS LAST,a.id,cl.revision,cl.anchor`,
        [ws, topic.topic_key],
      )
    ).rows;
    for (const claim of claims)
      claim.evidence_times.sort(
        (a: any, b: any) =>
          String(a.at).localeCompare(String(b.at)) ||
          String(a.kind).localeCompare(String(b.kind)),
      );
    // The lineage panel labels each relation by how it was produced
    // (추출·통합·수동); the producer already lives on its publication row, so
    // this is enrichment of an existing query, not new storage.
    const relations = (
      await c.query(
        `SELECT cr.*,p.producer->>'client' AS producer_client,p.created_at AS published_at
         FROM claim_relations cr LEFT JOIN publications p ON p.workspace_id=cr.workspace_id AND p.id=cr.publication_id
         JOIN articles a ON a.workspace_id=cr.workspace_id AND a.id=cr.from_article_id
         WHERE cr.workspace_id=$1 AND a.topic_key=$2 AND a.deleted_at IS NULL
         ORDER BY cr.created_at,cr.from_article_id,cr.from_anchor,cr.from_revision,cr.to_article_id,cr.to_revision,cr.to_anchor,cr.relation`,
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
    // Rejections restore the lineage panel's cancel-line marker
    // (docs/l2-l3-memory.md#relation-reject); the reject itself already
    // published a corrective Version, so this is read-only context.
    const rejections = (
      await c.query(
        `SELECT rr.from_article_id,rr.from_revision,rr.from_anchor,rr.to_article_id,rr.to_revision,rr.to_anchor,rr.relation,rr.reason,rr.publication_id,rr.created_at
         FROM claim_relation_rejections rr JOIN articles fa ON fa.workspace_id=rr.workspace_id AND fa.id=rr.from_article_id
         WHERE rr.workspace_id=$1 AND fa.topic_key=$2 ORDER BY rr.created_at`,
        [ws, topic.topic_key],
      )
    ).rows;
    const content = renderWikiPage(
      title,
      claims,
      relations,
      `/workspaces/${ws}/knowledge`,
      references,
    );
    const snapshot = {
      assemblyVersion: "topic-sections-6",
      claims,
      relations,
      references,
      rejections,
      tags,
      // The support folding the page text already applies, so the web renders
      // the same grouping without re-deriving the rule. Identity only: the
      // claims themselves are right above.
      clusters: supportClusters(claims, relations).map((cluster) => ({
        representative: claimKey(cluster.representative),
        members: cluster.members.map(claimKey),
      })),
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
// Live, not versioned: a Job's progress is process state, not a fact about
// the topic's knowledge, so it never enters the immutable snapshot
// (docs/l2-l3-memory.md#knowledge-화면--현재-주장-목록과-리니지-패널).
// completed carries no badge — a badge absent is never "review confirmed".
function consolidationBadge(job: {
  id: string;
  status: string;
  updated_at: string;
} | null) {
  if (!job || job.status === "completed") return null;
  return {
    state: job.status === "failed" ? "needs_attention" : "waiting",
    jobId: job.id,
    updatedAt: job.updated_at,
  };
}
export async function listWikiPages(c: PoolClient, ws: string, query: any) {
  const page = pagination(query),
    q = String(query?.q ?? "").slice(0, 200),
    tag = String(query?.tag ?? "");
  const rows = (
    await c.query(
      `SELECT p.*,jsonb_array_length(v.snapshot->'claims') AS claim_count,
        cj.id AS consolidation_job_id,cj.status AS consolidation_status,cj.updated_at AS consolidation_updated_at
      FROM wiki_pages p JOIN wiki_page_versions v ON v.workspace_id=p.workspace_id AND v.page_id=p.id AND v.revision=p.revision
      LEFT JOIN LATERAL (
        SELECT id,status,updated_at FROM consolidation_jobs WHERE workspace_id=p.workspace_id AND topic_key=p.topic_key ORDER BY created_at DESC LIMIT 1
      ) cj ON true
    WHERE p.workspace_id=$1 AND ($2='' OR position(lower($2) in lower(p.title||' '||p.content))>0) AND ($3='' OR $3=ANY(p.tags)) ORDER BY p.updated_at DESC,p.id LIMIT $4 OFFSET $5`,
      [ws, q, tag, page.size + 1, page.offset],
    )
  ).rows;
  return {
    ...paged(
      rows.map(
        ({
          consolidation_job_id,
          consolidation_status,
          consolidation_updated_at,
          ...row
        }) => ({
          ...row,
          consolidation: consolidationBadge(
            consolidation_job_id
              ? {
                  id: consolidation_job_id,
                  status: consolidation_status,
                  updated_at: consolidation_updated_at,
                }
              : null,
          ),
        }),
      ),
      page,
    ),
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
  const job = (
    await c.query(
      "SELECT id,status,updated_at FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2 ORDER BY created_at DESC LIMIT 1",
      [ws, row.topic_key],
    )
  ).rows[0];
  return {
    ...row,
    consolidation: consolidationBadge(job ?? null),
    // Same honesty rule as knowledge-context.ts/query.ts: a conversation-kind
    // source left jobless by a scoped curation rebuild still counts.
    hasUnprocessedSources: !!(
      await c.query(
        `SELECT 1 FROM refinement_jobs WHERE workspace_id=$1 AND status<>'completed'
         UNION ALL SELECT 1 FROM sources s WHERE s.workspace_id=$1 AND s.deleted_at IS NULL AND s.kind='conversation'
           AND NOT EXISTS(SELECT 1 FROM refinement_jobs j WHERE j.workspace_id=s.workspace_id AND j.source_id=s.id)
         LIMIT 1`,
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
