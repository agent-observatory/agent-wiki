import type { PoolClient } from "pg";
import { pagination, paged } from "./pagination.js";
import { sessionProgress } from "./session-progress.js";
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
  const sessions = await sessionProgress(c, ws);
  return {
    ...paged(sessions.slice(page.offset, page.offset + page.size + 1), page),
    total: sessions.length,
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
