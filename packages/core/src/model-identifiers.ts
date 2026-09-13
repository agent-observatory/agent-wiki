type Change = {
  clientRef: string;
  articleId: string | null;
  links: string[];
  claims: { anchor: string }[];
  claimRelations: { anchor: string }[];
};

// Only rename duplicate local identifiers with no references to disambiguate.
// Referenced duplicates remain invalid; assigning their meaning would be a guess.
export function normalizeModelIdentifiers<T extends Change>(input: T[]) {
  const changes = structuredClone(input);
  let renamedReferences = 0;
  let renamedAnchors = 0;
  const referenced = new Set(changes.flatMap((c) => c.links));
  const refs = new Set(changes.map((c) => c.clientRef));
  const seenRefs = new Set<string>();
  const fresh = (used: Set<string>, prefix: string) => {
    let n = 1;
    while (used.has(`${prefix}-${n}`)) n++;
    const value = `${prefix}-${n}`;
    used.add(value);
    return value;
  };
  for (const change of changes) {
    const ref = change.clientRef;
    if (seenRefs.has(ref) && !referenced.has(ref) && !change.articleId) {
      change.clientRef = fresh(refs, "change");
      renamedReferences++;
    }
    seenRefs.add(ref);
    const anchors = new Set(change.claims.map((c) => c.anchor));
    const seenAnchors = new Set<string>();
    const related = new Set(change.claimRelations.map((r) => r.anchor));
    for (const claim of change.claims) {
      const anchor = claim.anchor;
      if (
        seenAnchors.has(anchor) &&
        !related.has(anchor) &&
        !change.articleId
      ) {
        claim.anchor = fresh(anchors, "claim");
        renamedAnchors++;
      }
      seenAnchors.add(anchor);
    }
  }
  return { changes, renamedReferences, renamedAnchors };
}
