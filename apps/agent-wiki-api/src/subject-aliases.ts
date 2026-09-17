import { z } from "zod";
import type { PoolClient } from "pg";
import { AppError } from "../../../packages/core/src/db.js";
import { topicKeySchema } from "./consolidation-control.js";
// `subject` is the property a claim decides, and the same property kept
// arriving under two slugs — 154 subjects in production with whole families
// split by a stop word or a trailing facet. Consolidation only compares claims
// that share subject and scope, so a split means the two are never compared at
// all. A person joins them here; nothing is joined automatically.
const slug = topicKeySchema;
export const aliasInput = z
  .object({ alias: slug, canonical: slug, reason: z.string().min(1).max(500) })
  .strict();
export async function listSubjectAliases(c: PoolClient, ws: string) {
  return {
    items: (
      await c.query(
        "SELECT alias,canonical,reason,created_by,created_at FROM subject_aliases WHERE workspace_id=$1 ORDER BY canonical,alias",
        [ws],
      )
    ).rows,
  };
}
export async function addSubjectAlias(
  c: PoolClient,
  ws: string,
  input: z.infer<typeof aliasInput>,
  userId: string,
) {
  if (input.alias === input.canonical)
    throw new AppError(400, "SUBJECT_ALIAS_SELF");
  // Chains would make canonical() depend on how many times it is applied, and
  // two claims could resolve differently depending on insertion order. Refuse
  // both directions and let the person pick one canonical.
  const conflict = (
    await c.query(
      "SELECT alias,canonical FROM subject_aliases WHERE workspace_id=$1 AND (alias=$2 OR canonical=$3)",
      [ws, input.canonical, input.alias],
    )
  ).rows[0];
  if (conflict)
    throw new AppError(
      400,
      conflict.alias === input.canonical
        ? "SUBJECT_ALIAS_CHAIN"
        : "SUBJECT_ALIAS_IS_CANONICAL",
    );
  await c.query(
    `INSERT INTO subject_aliases(workspace_id,alias,canonical,reason,created_by) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (workspace_id,alias) DO UPDATE SET canonical=EXCLUDED.canonical,reason=EXCLUDED.reason,created_by=EXCLUDED.created_by,created_at=now()`,
    [ws, input.alias, input.canonical, input.reason, userId],
  );
  return { ok: true, alias: input.alias, canonical: input.canonical };
}
export async function removeSubjectAlias(
  c: PoolClient,
  ws: string,
  alias: string,
) {
  const removed = await c.query(
    "DELETE FROM subject_aliases WHERE workspace_id=$1 AND alias=$2",
    [ws, alias],
  );
  if (!removed.rowCount) throw new AppError(404, "SUBJECT_ALIAS_NOT_FOUND");
  return { ok: true, alias };
}
// Candidate split subjects, computed without a model. Plain token overlap
// buried the real pairs under namespace prefixes — `oci` is in 50 slugs,
// `container` in 16 — so tokens are weighted by how rare they are in this
// workspace's own vocabulary. This finds surface splits (a stop word, a
// trailing facet); genuine synonyms with no shared token are a person's job.
const STOP = new Set([
  "and",
  "or",
  "of",
  "the",
  "for",
  "with",
  "to",
  "in",
  "on",
  "a",
  "an",
  "vs",
  "via",
]);
export function subjectTokens(subject: string) {
  return subject
    .split(/[-_]/)
    .map((t) => t.toLowerCase())
    .filter((t) => t && !STOP.has(t))
    .map((t) =>
      t.endsWith("ies")
        ? t.slice(0, -3) + "y"
        : t.length > 3 && t.endsWith("s") && !t.endsWith("ss")
          ? t.slice(0, -1)
          : t,
    );
}
export function splitCandidates(subjects: string[], min = 0.6) {
  const tokens = new Map(subjects.map((s) => [s, new Set(subjectTokens(s))]));
  const df = new Map<string, number>();
  for (const set of tokens.values())
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const weight = (t: string) => Math.log(subjects.length / (df.get(t) ?? 1));
  const pairs: { a: string; b: string; score: number }[] = [];
  for (let i = 0; i < subjects.length; i++)
    for (let j = i + 1; j < subjects.length; j++) {
      const a = tokens.get(subjects[i])!,
        b = tokens.get(subjects[j])!;
      let shared = 0,
        total = 0;
      for (const t of new Set([...a, ...b])) {
        const w = weight(t);
        total += w;
        if (a.has(t) && b.has(t)) shared += w;
      }
      const score = total ? shared / total : 0;
      if (score >= min)
        pairs.push({
          a: subjects[i],
          b: subjects[j],
          score: Number(score.toFixed(3)),
        });
    }
  return pairs.sort(
    (x, y) =>
      y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
  );
}
export async function subjectSplitCandidates(
  c: PoolClient,
  ws: string,
  min = 0.6,
) {
  const rows = (
    await c.query(
      `SELECT cl.subject,count(*)::int AS claims,array_agg(DISTINCT a.topic_key) AS topics
       FROM claims cl JOIN articles a ON a.workspace_id=cl.workspace_id AND a.id=cl.article_id AND a.revision=cl.revision
       WHERE cl.workspace_id=$1 AND a.deleted_at IS NULL AND cl.subject<>'' AND cl.state='current'
       GROUP BY cl.subject ORDER BY cl.subject`,
      [ws],
    )
  ).rows;
  const known = (
    await c.query(
      "SELECT alias,canonical FROM subject_aliases WHERE workspace_id=$1",
      [ws],
    )
  ).rows;
  const pairKey = (a: string, b: string) => [a, b].sort().join(" ");
  const joined = new Set(known.map((r) => pairKey(r.alias, r.canonical)));
  const by = new Map(rows.map((r) => [r.subject as string, r]));
  return {
    subjects: rows.length,
    items: splitCandidates(
      rows.map((r) => r.subject as string),
      min,
    )
      .filter((p) => !joined.has(pairKey(p.a, p.b)))
      .map((p) => ({
        score: p.score,
        a: {
          subject: p.a,
          claims: by.get(p.a)!.claims,
          topics: by.get(p.a)!.topics,
        },
        b: {
          subject: p.b,
          claims: by.get(p.b)!.claims,
          topics: by.get(p.b)!.topics,
        },
      })),
  };
}
