import type { PoolClient } from "pg";
import { requireRow } from "../../../packages/core/src/db.js";
import { paged, type pagination } from "./pagination.js";

type Source = { id: string; kind: string; origin: string };
export async function sourceInfo(c: PoolClient, ws: string, id: string) {
  return requireRow(
    (
      await c.query(
        "SELECT id,name,kind,origin,revision,line_count,metadata,masked,created_at FROM sources WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
        [ws, id],
      )
    ).rows[0],
  );
}

// One accepted upload may produce multiple immutable source records. Count it
// once, and ignore uploads without newly committed sources (including duplicates).
const collections = `WITH collections AS (
  SELECT coalesce(u.id::text,s.id::text) AS id,
    coalesce(u.updated_at,s.created_at) AS collected_at,
    sum(s.line_count)::bigint AS line_count,
    sum((SELECT count(*) FROM collection_events e WHERE e.workspace_id=s.workspace_id AND e.source_id=s.id))::int AS event_count,
    max(coalesce(u.compressed_bytes,0))::bigint AS stored_bytes
  FROM sources s
  LEFT JOIN collection_uploads u ON u.workspace_id=s.workspace_id
    AND u.id::text=s.metadata->>'rawUploadId'
  WHERE s.workspace_id=$1 AND s.deleted_at IS NULL
    AND (($2='conversation' AND $3<>'' AND s.kind='conversation' AND s.origin=$3) OR s.id=$4)
    AND (NOT (s.metadata ? 'rawUploadId') OR u.status='completed')
  GROUP BY coalesce(u.id::text,s.id::text),coalesce(u.updated_at,s.created_at)
)`;
const args = (ws: string, source: Source) => [
  ws,
  source.kind,
  source.origin,
  source.id,
];

export async function collectionSummary(
  c: PoolClient,
  ws: string,
  source: Source,
) {
  const row = (
    await c.query(
      `${collections}
    SELECT count(*)::int AS count,max(collected_at) AS last_collected_at,
      coalesce(sum(line_count),0)::bigint AS line_count,coalesce(sum(event_count),0)::int AS event_count,coalesce(sum(stored_bytes),0)::bigint AS stored_bytes FROM collections`,
      args(ws, source),
    )
  ).rows[0];
  return {
    ...row,
    line_count: Number(row.line_count),
    stored_bytes: Number(row.stored_bytes),
  };
}

export async function collectionHistory(
  c: PoolClient,
  ws: string,
  source: Source,
  page: ReturnType<typeof pagination>,
) {
  const rows = (
    await c.query(
      `${collections}
    SELECT id,collected_at,line_count,event_count,stored_bytes,
      row_number() OVER (ORDER BY collected_at,id)=1 AS initial
    FROM collections ORDER BY collected_at DESC,id DESC LIMIT $5 OFFSET $6`,
      [...args(ws, source), page.size + 1, page.offset],
    )
  ).rows;
  return paged(
    rows.map((row) => ({
      ...row,
      line_count: Number(row.line_count),
      stored_bytes: Number(row.stored_bytes),
    })),
    page,
  );
}
