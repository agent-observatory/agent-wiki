import { readFile, writeFile } from "node:fs/promises";
import {
  rankQueryDocuments,
  legacyQueryRank,
  QUERY_POLICY,
} from "../../packages/core/src/query-ranking.js";
const fixture = JSON.parse(
  await readFile(new URL("./fixtures.json", import.meta.url), "utf8"),
);
const results: any[] = [];
for (const [name, rank] of [
  ["legacy-fields", legacyQueryRank],
  [QUERY_POLICY, rankQueryDocuments],
] as const) {
  const cases = fixture.cases.map((c: any) => {
    const ids = rank(fixture.documents, c.query)
      .slice(0, 3)
      .map((x) => x.document.id);
    const recall = c.expected.length
      ? c.expected.filter((id: string) => ids.includes(id)).length /
        c.expected.length
      : null;
    const position = ids.findIndex((id) => c.expected.includes(id));
    return {
      id: c.id,
      ids,
      recallAt3: recall,
      reciprocalRank: position < 0 ? 0 : 1 / (position + 1),
      pass: c.expected.length ? recall === 1 : ids.length === 0,
    };
  });
  results.push({
    policy: name,
    passed: cases.filter((c: any) => c.pass).length,
    total: cases.length,
    meanRecallAt3:
      cases
        .filter((c: any) => c.recallAt3 !== null)
        .reduce((s: number, c: any) => s + c.recallAt3, 0) /
      cases.filter((c: any) => c.recallAt3 !== null).length,
    cases,
  });
}
const report = {
  fixture: fixture.version,
  modelCalls: 0,
  l5Usage: null,
  scope:
    "Seed retrieval only; graph/state/API contracts are separate CI tests. Not end-to-end L5 quality.",
  results,
};
await writeFile(
  new URL("./results.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(results.map(({ cases, ...r }) => r)));
if (results[1].passed < results[0].passed) process.exitCode = 1;
