// How the claim list folds a Version snapshot's support clusters.
//
// Pulled out of the component so it can be tested against a real snapshot.
// The first version of this lived inline and silently did nothing for a whole
// day: the snapshot writes membership as `id:rev:anchor` and the component
// built its lookup with a different separator, so every match missed. The page
// text folded, the list on screen did not, and nothing failed.
export type ClusterRef = { representative: string; members: string[] };
export type FoldedClaims<T> = {
  /** Claims the list renders: one per support cluster, plus unclustered ones. */
  rows: T[];
  /** Representative key -> the current claims folded under it. */
  membersOf: Map<string, T[]>;
  /** How many claims the fold removed from the list. */
  foldedCount: number;
};
// MUST match claimKey in packages/core/src/wiki-page.ts, which is what the
// snapshot's membership strings are written with.
export function claimKeyOf(c: {
  article_id: string;
  revision: number;
  anchor: string;
}) {
  return `${c.article_id}:${c.revision}:${c.anchor}`;
}
export function foldClaims<
  T extends { article_id: string; revision: number; anchor: string; state: string },
>(claims: T[], clusters: ClusterRef[] | undefined): FoldedClaims<T> {
  const current = claims.filter((c) => c.state === "current");
  // An older Version has no clusters. Draw it flat rather than guessing.
  if (!clusters?.length)
    return { rows: current, membersOf: new Map(), foldedCount: 0 };
  const byKey = new Map(current.map((c) => [claimKeyOf(c), c]));
  const membersOf = new Map<string, T[]>();
  const foldedInto = new Map<string, string>();
  for (const cluster of clusters) {
    const members = cluster.members
      .map((k) => byKey.get(k))
      .filter((c): c is T => !!c);
    if (members.length) membersOf.set(cluster.representative, members);
    for (const k of cluster.members) foldedInto.set(k, cluster.representative);
  }
  return {
    rows: current.filter((c) => !foldedInto.has(claimKeyOf(c))),
    membersOf,
    foldedCount: [...membersOf.values()].reduce((n, m) => n + m.length, 0),
  };
}
