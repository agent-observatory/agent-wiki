import type { PoolClient } from "pg";
// A claim's stored `subject` never changes: it is what the model said at that
// moment and part of the immutable Revision. When one property ends up with
// two slugs, the two are joined here and every place that COMPARES subjects
// resolves through this map first — the relation gate, Consolidation's
// grouping, the worker's vocabulary hint and page assembly.
export type SubjectAliases = Map<string, string>;
export async function loadSubjectAliases(
  c: PoolClient,
  ws: string,
): Promise<SubjectAliases> {
  const rows = (
    await c.query(
      "SELECT alias,canonical FROM subject_aliases WHERE workspace_id=$1",
      [ws],
    )
  ).rows;
  return new Map(rows.map((r) => [r.alias as string, r.canonical as string]));
}
// One lookup, never a chain: the API refuses an alias whose canonical is
// itself an alias, so this cannot loop and two subjects always resolve the
// same way regardless of insertion order.
export function canonicalSubject(aliases: SubjectAliases, subject: string) {
  return aliases.get(subject) ?? subject;
}
