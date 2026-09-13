import { z } from "zod";
import {
  changeInput,
  MAX_PUBLICATION_CHANGES,
} from "../../agent-wiki-api/src/knowledge.js";
import { ModelError } from "../../../packages/core/src/ai.js";
import { resolveRecordEvidence } from "../../../packages/core/src/model-records.js";
import {
  normalizeModelEvidence,
  anchorModelEvidence,
  summarizeModelEvidence,
} from "../../../packages/core/src/model-evidence.js";
import { normalizeModelIdentifiers } from "../../../packages/core/src/model-identifiers.js";
import { touchesOmitted } from "../../../packages/core/src/curation-input.js";
import { evidenceHasRole } from "../../../packages/core/src/source-roles.js";
import { originalEvidence } from "../../../packages/core/src/curation-batch.js";
import { normalizeLocalHistoryStates } from "../../../packages/core/src/local-history.js";
export function prepareProposal(
  output: unknown,
  input: any,
  diagnostics: Record<string, unknown>,
) {
  const proposal = expandProposalContent(output);
  const result = z
    .object({
      changes: z.array(changeInput).max(MAX_PUBLICATION_CHANGES),
    })
    .strict()
    .parse(
      normalizeModelEvidence(resolveRecordEvidence(proposal, input.source)),
    );
  if (result.changes.some((change) => !change.topic))
    throw new ModelError("AI_TOPIC_REQUIRED");
  const identifiers = normalizeModelIdentifiers(result.changes);
  result.changes = identifiers.changes;
  diagnostics.renamedReferences = identifiers.renamedReferences;
  diagnostics.renamedAnchors = identifiers.renamedAnchors;
  for (const change of result.changes) {
    for (const evidence of [
      ...change.claims.flatMap((claim) => claim.evidence),
      ...change.claimRelations.flatMap((relation) => relation.evidence),
    ]) {
      const anchored = anchorModelEvidence(evidence, input.source);
      if (anchored) {
        Object.assign(evidence, anchored);
        diagnostics.anchoredEvidence =
          Number(diagnostics.anchoredEvidence ?? 0) + 1;
      }
    }
  }
  const evidence = result.changes.flatMap((change) => [
    ...change.claims.flatMap((claim) => claim.evidence),
    ...change.claimRelations.flatMap((relation) => relation.evidence),
  ]);
  const evidenceValidation = summarizeModelEvidence(evidence, input.source);
  diagnostics.evidenceValidation = evidenceValidation;
  diagnostics.rejectedEvidence = evidence.flatMap((item, index) =>
    summarizeModelEvidence([item], input.source).matched ? [] : [index],
  );
  // Reject before caching a publication payload. The rejected response
  // remains in its execution history, never as publish-only recovery.
  if (evidenceValidation.mismatched) throw new ModelError("EVIDENCE_MISMATCH");
  for (const change of result.changes) {
    for (const claim of change.claims)
      if (claim.type === "unconfirmed") claim.state = "unconfirmed";
    if (
      !change.claims.length ||
      change.claims.some(
        (claim) =>
          claim.evidence.some((e) =>
            touchesOmitted(e.lines, input.source.omittedLines),
          ) ||
          !claim.evidence.length ||
          claim.evidence.some(
            (e) =>
              e.sourceId !== input.source.id ||
              e.lines[0] < input.source.start ||
              e.lines[1] > input.source.end,
          ),
      )
    )
      throw new ModelError("AI_EVIDENCE_REQUIRED");
    const downgraded = new Set<string>();
    for (const claim of change.claims) {
      if (
        (claim.type === "user_decision" &&
          !evidenceHasRole(claim.evidence, input.source.roles, ["user"])) ||
        (claim.type === "observation" &&
          !evidenceHasRole(claim.evidence, input.source.roles, [
            "user",
            "tool",
          ]))
      ) {
        claim.type = "unconfirmed";
        claim.state = "unconfirmed";
        downgraded.add(claim.anchor);
      }
    }
    if (downgraded.size) {
      diagnostics.unconfirmedClaims =
        Number(diagnostics.unconfirmedClaims ?? 0) + downgraded.size;
      change.claimRelations = change.claimRelations.filter(
        (r) => !downgraded.has(r.anchor),
      );
    }
    if (change.articleId || change.baseRevision || change.supersedes.length)
      throw new ModelError("AI_WHOLE_ARTICLE_REPLACEMENT_FORBIDDEN");
    for (const relation of change.claimRelations) {
      const target = relation.target;
      if ("clientRef" in target) {
        const priorIndex = result.changes.findIndex(
          (item) => item.clientRef === target.clientRef,
        );
        if (
          priorIndex < 0 ||
          priorIndex >= result.changes.indexOf(change) ||
          !result.changes[priorIndex].claims.some(
            (claim) => claim.anchor === target.anchor,
          )
        )
          throw new ModelError("AI_UNKNOWN_CLAIM_TARGET");
        continue;
      }
      if (
        !input.related.some(
          (a: any) =>
            a.id === target.articleId &&
            a.revision === target.revision &&
            a.anchor === target.anchor,
        )
      )
        throw new ModelError("AI_UNKNOWN_CLAIM_TARGET");
    }
    // No ungrounded narrative outside the claims is allowed into automatic knowledge.
    change.content = change.claims.map((c) => c.text).join("\n\n");
    for (const item of [...change.claims, ...change.claimRelations])
      item.evidence = item.evidence.flatMap((e) =>
        originalEvidence(e, input.source.spans),
      );
  }
  const localHistory = normalizeLocalHistoryStates(result.changes);
  result.changes = localHistory.changes;
  diagnostics.normalizedLocalHistoryStates = localHistory.normalized;
  if (
    result.changes.some((change) =>
      change.claims.some((claim) =>
        ["superseded", "retracted"].includes(claim.state),
      ),
    )
  )
    throw new ModelError("AI_INVALID_NEW_CLAIM_STATE");

  return result;
}

// Public publication inputs retain content; the model emits each Claim only once.
export function expandProposalContent(output: unknown): unknown {
  if (
    !output ||
    typeof output !== "object" ||
    !("changes" in output) ||
    !Array.isArray(output.changes)
  )
    return output;
  return {
    ...output,
    changes: output.changes.map((change: any) => {
      if (
        !change ||
        !Array.isArray(change.claims) ||
        !change.claims.length ||
        !change.claims.every((c: any) => c && typeof c.text === "string")
      )
        return change;
      return {
        ...change,
        content: change.claims.map((c: any) => c.text).join("\n\n"),
      };
    }),
  };
}
