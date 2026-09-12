import type { PoolClient } from "pg";
// Arrival order schedules storage, not semantic validity. Within one upload,
// the server part index restores order even when timestamps tie.
const part = `CASE
 WHEN s.metadata->>'partIndex' ~ '^[0-9]+$' THEN (s.metadata->>'partIndex')::bigint
 WHEN s.idempotency_key ~ '^upload-[0-9a-f-]{36}-[0-9]+$' THEN substring(s.idempotency_key from '([0-9]+)$')::bigint
 ELSE 0 END`;
// Rank unfinished work once. A failed or delayed head blocks only its own
// session. A correlated predecessor check per source becomes quadratic.
export const curationHeads = `SELECT j.id,j.status,j.available_at,
 s.created_at AS source_created_at,COALESCE(s.metadata->>'rawUploadId',s.id::text) AS upload_order,${part} AS part_index,s.id AS source_id,
 row_number() OVER(PARTITION BY CASE WHEN s.kind='conversation' AND s.origin<>'' THEN 'conversation:'||s.origin ELSE 'source:'||s.id::text END
 ORDER BY s.created_at,COALESCE(s.metadata->>'rawUploadId',s.id::text),${part},s.id) AS queue_position
 FROM refinement_jobs j JOIN sources s ON s.id=j.source_id AND s.workspace_id=j.workspace_id
 WHERE j.workspace_id=$1 AND j.status<>'completed' AND s.deleted_at IS NULL`;
export async function nextCurationJob(c: PoolClient, ws: string) {
  const result = await c.query(
    `WITH heads AS (${curationHeads})
 SELECT j.* FROM heads h JOIN refinement_jobs j ON j.id=h.id AND j.workspace_id=$1
 WHERE h.queue_position=1 AND j.status='pending' AND j.available_at<=now()
 ORDER BY h.source_created_at,h.upload_order,h.part_index,h.source_id
 LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
    [ws],
  );
  return result.rows[0] ?? null;
}
