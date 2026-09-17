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
    for (const claim of change.claims) {
      if (claim.type === "agent_statement") claim.state = "unconfirmed";
      // The prompt says an assistant proposal is ai_inference/proposed, but
      // nothing enforced it, so a model's own interpretation could sit in the
      // wiki as a current fact beside the user's decisions. Downgrade rather
      // than reject: the assertion is worth keeping, its adoption is not ours
      // to claim.
      if (claim.type === "ai_inference" && claim.state === "current")
        claim.state = "proposed";
    }
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
        claim.type = "agent_statement";
        claim.state = "unconfirmed";
        downgraded.add(claim.anchor);
      }
    }
    if (downgraded.size) {
      diagnostics.unconfirmedClaims =
        Number(diagnostics.unconfirmedClaims ?? 0) + downgraded.size;
      // Only an adopted assertion may replace or withdraw another, so a
      // demoted claim's supersedes/retracts cannot stand — dropping them here
      // is what keeps the chunk from failing on CLAIM_REPLACEMENT_NOT_CURRENT
      // and regenerating forever. supports and contradicts carry no such rule
      // and were being thrown away with them: the demotion is about who
      // asserted the claim, not about whether it agrees with another one.
      const dropped = change.claimRelations.filter(
        (r) =>
          downgraded.has(r.anchor) &&
          ["supersedes", "retracts"].includes(r.relation),
      );
      if (dropped.length) {
        diagnostics.droppedRelations = [
          ...((diagnostics.droppedRelations as unknown[]) ?? []),
          ...dropped.map((r) => ({
            anchor: r.anchor,
            relation: r.relation,
            reason: "CLAIM_REPLACEMENT_NOT_CURRENT",
          })),
        ];
      }
      change.claimRelations = change.claimRelations.filter(
        (r) =>
          !downgraded.has(r.anchor) ||
          !["supersedes", "retracts"].includes(r.relation),
      );
    }
    if (change.articleId || change.baseRevision || change.supersedes.length)
      throw new ModelError("AI_WHOLE_ARTICLE_REPLACEMENT_FORBIDDEN");
    // subject and scope are the relation gate: storeClaimRelations refuses a
    // relation whose ends disagree on either, and that refusal failed the whole
    // publish, so one bad relation threw away every claim in the chunk. The
    // chunk then regenerated and the model proposed it again — one production
    // chunk burned seven calls that way before being parked, losing its claims
    // for good. Unlike a moved target this can never become valid later, so it
    // does not belong in the inbox either: drop the relation, keep the claims,
    // and say so in the diagnostics.
    const endOf = (anchor: string, target: any) => {
      if ("clientRef" in target) {
        const prior = result.changes.find(
          (item) => item.clientRef === target.clientRef,
        );
        return prior?.claims.find((c) => c.anchor === target.anchor);
      }
      return input.related.find(
        (a: any) =>
          a.id === target.articleId &&
          a.revision === target.revision &&
          a.anchor === target.anchor,
      );
    };
    const crossScope = change.claimRelations.filter((relation) => {
      const from = change.claims.find((c) => c.anchor === relation.anchor);
      const to = endOf(relation.anchor, relation.target);
      return (
        from &&
        to &&
        (!from.subject ||
          !from.scope ||
          from.subject !== to.subject ||
          from.scope !== to.scope)
      );
    });
    if (crossScope.length) {
      diagnostics.droppedRelations = [
        ...((diagnostics.droppedRelations as unknown[]) ?? []),
        ...crossScope.map((r) => ({
          anchor: r.anchor,
          relation: r.relation,
          reason: "CLAIM_SCOPE_MISMATCH",
        })),
      ];
      change.claimRelations = change.claimRelations.filter(
        (r) => !crossScope.includes(r),
      );
    }
    for (const relation of change.claimRelations) {
      // Only an adopted assertion replaces or withdraws an older one. Reject
      // here so the model regenerates instead of failing at publish.
      if (
        ["supersedes", "retracts"].includes(relation.relation) &&
        change.claims.find((claim) => claim.anchor === relation.anchor)
          ?.state !== "current"
      )
        throw new ModelError("CLAIM_REPLACEMENT_NOT_CURRENT");
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
