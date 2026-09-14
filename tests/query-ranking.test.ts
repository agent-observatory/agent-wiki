import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rankQueryDocuments,
  legacyQueryRank,
  uncoveredTermGroups,
} from "../packages/core/src/query-ranking.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("../experiments/query/fixtures.json", import.meta.url),
    "utf8",
  ),
);
test("fixed ten-question seed retrieval meets baseline without a model", () => {
  let current = 0,
    baseline = 0;
  for (const q of fixture.cases) {
    const pass = (rank: typeof rankQueryDocuments) => {
      const ids = rank(fixture.documents, q.query)
        .slice(0, 3)
        .map((x) => x.document.id);
      return q.expected.length
        ? q.expected.every((x: string) => ids.includes(x))
        : !ids.length;
    };
    if (pass(rankQueryDocuments)) current++;
    if (pass(legacyQueryRank as any)) baseline++;
  }
  assert.ok(current >= baseline);
  assert.equal(current, 10);
});
test("BM25 saturates repeated text; ties are stable; aliases and Korean particles are searchable", () => {
  const docs = [
    { id: "a", title: "제공자", content: "NVIDIA 호출", aliases: ["엔비디아"] },
    { id: "b", title: "화면", content: "간격" },
  ];
  assert.equal(rankQueryDocuments(docs, "엔비디아로")[0].document.id, "a");
  assert.equal(rankQueryDocuments(docs, "존재하지않는주제").length, 0);
  assert.deepEqual(
    rankQueryDocuments(docs, "NVIDIA"),
    rankQueryDocuments([...docs].reverse(), "NVIDIA"),
  );
  const one = rankQueryDocuments(
    [{ id: "a", title: "", content: "word" }],
    "word",
  )[0].score;
  const many = rankQueryDocuments(
    [{ id: "a", title: "", content: "word ".repeat(1000) }],
    "word",
  )[0].score;
  assert.ok(many / one < 2.3);
});

// Regression suite predates BM25: retain multi-keyword coverage and literal names.
test("existing retrieval questions retain relevant decisions over single-word title distractors", () => {
  const old = JSON.parse(
    readFileSync(
      new URL("../experiments/retrieval/cases.json", import.meta.url),
      "utf8",
    ),
  );
  const docs = old.documents.map((d: any) => ({ ...d, id: d.key }));
  for (const q of old.queries.filter((q: any) => !q.semantic))
    assert.equal(
      rankQueryDocuments(docs, q.q)[0]?.document.id,
      q.expected,
      q.q,
    );
});

// Production observations (2026-09-14) replayed on synthetic analogs. The
// recorded outcome is asserted so a ranking change must flip knownFailing on
// purpose instead of silently changing what the evaluation reports.
test("observed retrieval regressions keep their recorded outcome and expose unmatched terms", () => {
  const byId = new Map<string, any>(
    [...fixture.documents, ...fixture.regressionDocuments].map((d: any) => [
      d.id,
      d,
    ]),
  );
  for (const r of fixture.regressions) {
    const corpus = r.corpus.map((id: string) => byId.get(id));
    const ids = rankQueryDocuments(corpus, r.query).map((x) => x.document.id);
    const pass =
      r.criterion === "empty" ? ids.length === 0 : ids[0] === r.expected[0];
    assert.equal(pass, !r.knownFailing, r.id);
  }
  const docs = [
    {
      id: "payg",
      title: "유료 계정 전환 결정",
      content: "전환 이유는 한도다.",
    },
    { id: "k3s", title: "K3s 실행 구성", content: "단일 VM에서 관리한다." },
  ];
  assert.deepEqual(uncoveredTermGroups(docs, "K3s 전환 이유"), []);
  assert.deepEqual(uncoveredTermGroups([docs[0]], "K3s 전환 이유는"), ["k3s"]);
  assert.deepEqual(uncoveredTermGroups(docs, "Claim 전환"), ["claim"]);
  assert.deepEqual(uncoveredTermGroups(docs, ""), []);
});
