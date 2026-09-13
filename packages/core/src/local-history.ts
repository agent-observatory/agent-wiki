type Change = {
  clientRef: string;
  claims: {
    anchor: string;
    state: string;
    type: string;
    subject: string;
    scope: string;
  }[];
  claimRelations: {
    anchor: string;
    relation: string;
    target: { clientRef?: string; anchor: string };
  }[];
};

// Models sometimes label A "superseded" while also emitting B -> A. The stored
// relation owns that state. Undo only this redundant label, after role checking,
// without inventing a replacement or accepting an unlinked historical claim.
export function normalizeLocalHistoryStates<T extends Change>(input: T[]) {
  const changes = structuredClone(input);
  let normalized = 0;
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index];
    for (const relation of change.claimRelations) {
      const ref = relation.target.clientRef;
      if (!ref || !["supersedes", "retracts"].includes(relation.relation))
        continue;
      const priorIndex = changes.findIndex((item) => item.clientRef === ref);
      if (priorIndex < 0 || priorIndex >= index) continue;
      const from = change.claims.find(
        (claim) => claim.anchor === relation.anchor,
      );
      const target = changes[priorIndex].claims.find(
        (claim) => claim.anchor === relation.target.anchor,
      );
      const retired =
        relation.relation === "supersedes" ? "superseded" : "retracted";
      if (
        from?.state !== "current" ||
        target?.state !== retired ||
        !target.subject ||
        !target.scope ||
        from.subject !== target.subject ||
        from.scope !== target.scope ||
        (target.type === "user_decision" && from.type !== "user_decision")
      )
        continue;
      target.state = "current";
      normalized++;
    }
  }
  return { changes, normalized };
}
