import type { PoolClient } from "pg";
import { effectiveClaimState } from "../../agent-wiki-api/src/claim-relations.js";
import { estimateTokens } from "../../../packages/core/src/chunking.js";
import {
  CANDIDATE_POLICY,
  rankKnowledgeCandidates,
} from "../../../packages/core/src/knowledge-candidates.js";

// Fixed reservation prevents later knowledge growth from changing an existing
// chunk's budget. These are retrieval hints; only the incoming L1 is evidence
// for a newly extracted assertion. Production runs under the 1,800-byte budget
// admitted 1–3 of 24 candidates (Korean is 3 bytes per character), so the
// model rarely saw an existing claim and re-created it: 4,500 bytes with
// shorter candidate text admits several distinct topics instead of one.
export const CONTEXT_BUDGET = 1800;
export const CONTEXT_BUDGET_MAX = 4500;
export const CONTEXT_CANDIDATE_CHARS = 300;
export const CONTEXT_MAX_RELATED = 8;
// 15% of the configured input target, never below the historical 1,800 bytes
// nor above 4,500: 30,000 → 4,500, the 8,000 default → 1,800.
export function contextBudget(maxInputTokens: number) {
  return Math.min(
    CONTEXT_BUDGET_MAX,
    Math.max(CONTEXT_BUDGET, Math.floor(maxInputTokens * 0.15)),
  );
}
export const CONTEXT_POLICY_VERSION = CANDIDATE_POLICY;
export async function curationContext(
  c: PoolClient,
  ws: string,
  sourceId: string,
  text: string,
  budget = CONTEXT_BUDGET,
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
    .join(" ");
  const rows = (
    await c.query(
      `SELECT a.id,a.title,a.revision,a.aliases,cl.anchor,cl.text,cl.type,cl.subject,cl.scope,
 ${effectiveClaimState("cl")} AS state,
 EXISTS(SELECT 1 FROM evidence e JOIN sources prior ON prior.workspace_id=e.workspace_id AND prior.id=e.source_id
 JOIN sources incoming ON incoming.workspace_id=prior.workspace_id AND incoming.id=$2
 WHERE e.workspace_id=cl.workspace_id AND e.article_id=cl.article_id AND e.revision=cl.revision AND e.anchor=cl.anchor
 AND incoming.kind='conversation' AND prior.kind='conversation' AND incoming.origin<>'' AND prior.origin=incoming.origin) AS same_session
 FROM articles a JOIN claims cl ON cl.workspace_id=a.workspace_id AND cl.article_id=a.id AND cl.revision=a.revision
 WHERE a.workspace_id=$1 AND a.deleted_at IS NULL AND (${effectiveClaimState("cl")}) NOT IN ('superseded','retracted')`,
      [ws, sourceId],
    )
  ).rows;
  const result = rankKnowledgeCandidates(rows, query);
  const related: any[] = [];
  let budgetSkipped = 0;
  for (const hit of result.ranked) {
    // The model must not cite a related claim's evidence, so its source ids
    // are omitted from the payload; the fixed article/revision/anchor is enough
    // for relations and the server restores evidence from L1.
    const { aliases, ...row } = hit.candidate;
    const candidate = {
      ...row,
      text: row.text.slice(0, CONTEXT_CANDIDATE_CHARS),
      textTruncated: row.text.length > CONTEXT_CANDIDATE_CHARS,
      ...(hit.reasons.includes("ambiguous_session_reference")
        ? { unresolvedReference: true }
        : {}),
    };
    // Keep a top-ranked long claim usable, but make its partial nature explicit.
    // Never drop the L1 input or silently treat a shortened claim as complete.
    while (
      candidate.text.length > 80 &&
      estimateTokens(JSON.stringify([...related, candidate])) > budget
    ) {
      candidate.text = Array.from(candidate.text).slice(0, -40).join("");
      candidate.textTruncated = true;
    }
    if (estimateTokens(JSON.stringify([...related, candidate])) > budget) {
      budgetSkipped++;
      continue;
    }
    related.push(candidate);
    if (related.length === CONTEXT_MAX_RELATED) break;
  }
  return {
    related,
    diagnostics: {
      corpusSize: result.corpusSize,
      queryTerms: result.queryTerms,
      matchedCandidates: result.matchedCandidates,
      shortlisted: result.ranked.length,
      budgetSkipped,
      // IDs, scores and rule names only; no source text or search terms in logs.
      candidates: result.ranked.map((hit, rank) => ({
        id: hit.candidate.id,
        anchor: hit.candidate.anchor,
        revision: hit.candidate.revision,
        rank: rank + 1,
        bm25: Number(hit.bm25.toFixed(4)),
        score: Number(hit.score.toFixed(4)),
        reasons: hit.reasons,
      })),
    },
  };
}
