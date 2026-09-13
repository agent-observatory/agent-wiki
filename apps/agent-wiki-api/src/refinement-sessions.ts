import type { PoolClient } from "pg";
import { pagination, paged } from "./pagination.js";
import { sourceInfo } from "./source-history.js";

const visibleJobs = `FROM refinement_jobs j JOIN sources s
  ON s.workspace_id=j.workspace_id AND s.id=j.source_id
  WHERE j.workspace_id=$1 AND s.deleted_at IS NULL`;

export async function refinementSessions(
  c: PoolClient,
  ws: string,
  query: unknown,
) {
  const page = pagination(query, "sessionsPage");
  const grouped = `WITH grouped AS (
    SELECT (array_agg(s.id ORDER BY s.created_at,s.id))[1] AS id,
      (array_agg(s.name ORDER BY s.created_at DESC,s.id DESC))[1] AS name,
      count(*)::int AS total,
      count(*) FILTER(WHERE j.status='pending')::int AS pending,
      count(*) FILTER(WHERE j.status='running')::int AS running,
      count(*) FILTER(WHERE j.status='failed')::int AS failed,
      count(*) FILTER(WHERE j.status='completed')::int AS completed,
      count(*) FILTER(WHERE j.status='pending' AND j.error_code IS NOT NULL)::int AS retrying,
      sum(j.chunk_index)::int AS chunks_done,sum(j.chunk_count)::int AS chunks_total,
      COALESCE(sum(j.chunk_index) FILTER(WHERE j.status<>'completed' AND j.batch_parent IS NULL),0)::int AS active_chunks_done,
      COALESCE(sum(j.chunk_count) FILTER(WHERE j.status<>'completed' AND j.batch_parent IS NULL),0)::int AS active_chunks_total,
      count(*) FILTER(WHERE j.status<>'completed' AND j.batch_parent IS NULL AND j.chunk_count=0 AND j.input_sources IS NULL)::int AS waiting_sources,
      count(*) FILTER(WHERE j.status='pending' AND j.batch_parent IS NULL AND j.chunk_count>0)::int AS active_batches,

      count(*) FILTER(WHERE j.chunk_count=0 AND j.status<>'completed' AND j.batch_parent IS NULL AND j.input_sources IS NULL)::int AS unplanned,
      max(j.updated_at) AS updated_at
    ${visibleJobs}
    GROUP BY CASE WHEN s.kind='conversation' AND s.origin<>'' THEN s.origin ELSE s.id::text END
  )`;
  const result = await c.query(
    `${grouped}
    SELECT *,count(*) OVER()::int AS session_total FROM grouped
    ORDER BY CASE WHEN running>0 THEN 0 WHEN failed>0 THEN 1 WHEN retrying>0 THEN 2 WHEN pending>0 THEN 3 ELSE 4 END,
      updated_at DESC,id LIMIT $2 OFFSET $3`,
    [ws, page.size + 1, page.offset],
  );
  // Keep total available even for an empty or out-of-range page.
  const total =
    result.rows[0]?.session_total ??
    (
      await c.query(`${grouped} SELECT count(*)::int AS total FROM grouped`, [
        ws,
      ])
    ).rows[0].total;
  return {
    ...paged(
      result.rows.map(({ session_total, ...row }) => row),
      page,
    ),
    total,
  };
}

export async function refinementSessionJobs(
  c: PoolClient,
  ws: string,
  id: string,
  query: unknown,
) {
  const source = await sourceInfo(c, ws, id),
    page = pagination(query, "detailPage");
  const result = await c.query(
    `SELECT j.id,j.source_id,j.status,j.attempts,j.error_code,j.chunk_index,j.chunk_count,j.available_at,j.updated_at,j.result,s.name
    ${visibleJobs} AND (($2='conversation' AND $3<>'' AND s.kind='conversation' AND s.origin=$3) OR s.id=$4)
    ORDER BY CASE WHEN j.status='running' THEN 0 WHEN j.status='failed' THEN 1 WHEN j.status='pending' AND j.error_code IS NOT NULL THEN 2 WHEN j.status='pending' THEN 3 ELSE 4 END,j.created_at,j.id
    LIMIT $5 OFFSET $6`,
    [ws, source.kind, source.origin, source.id, page.size + 1, page.offset],
  );
  return paged(result.rows, page);
}

export async function retryRefinementSession(
  c: PoolClient,
  ws: string,
  id: string,
) {
  const source = await sourceInfo(c, ws, id);
  const result = await c.query(
    `UPDATE refinement_jobs j SET status='pending',attempts=0,available_at=now(),error_code=NULL,output=NULL,run_id=NULL,lease_until=NULL,updated_at=now()
 FROM sources s WHERE j.workspace_id=$1 AND s.workspace_id=j.workspace_id AND s.id=j.source_id AND s.deleted_at IS NULL AND j.status='failed'
 AND (($2='conversation' AND $3<>'' AND s.kind='conversation' AND s.origin=$3) OR s.id=$4) RETURNING j.id`,
    [ws, source.kind, source.origin, source.id],
  );
  return { retried: result.rowCount };
}
