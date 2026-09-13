import type { PoolClient } from "pg";
import { effectiveClaimState } from "../../agent-wiki-api/src/claim-relations.js";
import { estimateTokens } from "../../../packages/core/src/chunking.js";

// Fixed reservation prevents later knowledge growth from changing an existing
// chunk's budget. These are retrieval hints; only the incoming L1 is evidence
// for a newly extracted assertion.
export const CONTEXT_BUDGET = 1800;
export const CONTEXT_POLICY_VERSION = "workspace-topic-relevance-2";
export async function curationContext(
  c: PoolClient,
  ws: string,
  sourceId: string,
  text: string,
) {
  // Search decoded conversational text, including late-chunk topic changes.
  const query = text
    .split("\n")
    .map((line) => {
      try {
        const row = JSON.parse(line),
          path = JSON.parse(row.field);
        return Array.isArray(path) &&
          !["role", "type", "id", "call_id"].includes(path.at(-1)) &&
          typeof row.text === "string"
          ? row.text
          : "";
      } catch {
        return line;
      }
    })
    .join(" ")
    .slice(0, 120000);
  const rows = (
    await c.query(
      `WITH candidates AS (SELECT a.id,a.title,a.revision,cl.anchor,cl.text,cl.type,cl.subject,cl.scope,a.updated_at,
 greatest(word_similarity(a.title||' '||cl.subject||' '||cl.scope,$3),word_similarity(left(cl.text,2000),$3),COALESCE((SELECT max(word_similarity(alias,$3)) FROM unnest(a.aliases) alias),0)) AS relevance,
 ${effectiveClaimState("cl")} AS state,
 EXISTS(SELECT 1 FROM evidence e JOIN sources prior ON prior.workspace_id=e.workspace_id AND prior.id=e.source_id
 JOIN sources incoming ON incoming.workspace_id=prior.workspace_id AND incoming.id=$2
 WHERE e.workspace_id=cl.workspace_id AND e.article_id=cl.article_id AND e.revision=cl.revision AND e.anchor=cl.anchor
 AND incoming.kind='conversation' AND prior.kind='conversation' AND incoming.origin<>'' AND prior.origin=incoming.origin) AS same_session
 FROM articles a JOIN claims cl ON cl.workspace_id=a.workspace_id AND cl.article_id=a.id AND cl.revision=a.revision
 WHERE a.workspace_id=$1 AND a.deleted_at IS NULL AND (${effectiveClaimState("cl")}) NOT IN ('superseded','retracted')
 ), ranked AS (
 SELECT candidates.*,row_number() OVER(PARTITION BY same_session ORDER BY relevance DESC,updated_at DESC,id,anchor) AS session_rank FROM candidates
 )
 SELECT id,title,revision,anchor,text,type,subject,scope,state,same_session FROM ranked
 ORDER BY relevance DESC,same_session DESC,updated_at DESC,id,anchor LIMIT 24`,
      [ws, sourceId, query],
    )
  ).rows;
  const related: any[] = [];
  for (const row of rows) {
    const evidence = (
      await c.query(
        "SELECT source_id,source_revision,line_start,line_end FROM evidence WHERE workspace_id=$1 AND article_id=$2 AND revision=$3 AND anchor=$4 ORDER BY source_id,line_start LIMIT 2",
        [ws, row.id, row.revision, row.anchor],
      )
    ).rows;
    const candidate = {
      ...row,
      text: row.text.slice(0, 600),
      textTruncated: row.text.length > 600,
      evidence,
    };
    if (
      estimateTokens(JSON.stringify([...related, candidate])) > CONTEXT_BUDGET
    )
      continue;
    related.push(candidate);
    if (related.length === 6) break;
  }
  return related;
}
