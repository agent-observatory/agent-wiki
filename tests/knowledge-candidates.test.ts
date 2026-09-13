import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lexicalTerms,
  rankKnowledgeCandidates,
  type KnowledgeCandidate,
} from "../packages/core/src/knowledge-candidates.js";
const doc = (
  id: string,
  text: string,
  fields: Partial<KnowledgeCandidate> = {},
): KnowledgeCandidate => ({
  id,
  anchor: "decision",
  title: "",
  text,
  subject: "",
  scope: "",
  aliases: [],
  same_session: false,
  ...fields,
});

test("BM25 uses corpus rarity, saturates repeated words and ignores query repetition", () => {
  const corpus = [
    doc("rare", "NVIDIA 모델 호출"),
    doc("repeated", "모델 ".repeat(200)),
    doc("normal", "모델 설정"),
  ];
  const rank = (query: string) => rankKnowledgeCandidates(corpus, query).ranked;
  assert.equal(rank("NVIDIA 모델")[0].candidate.id, "rare");
  assert.deepEqual(
    rank("NVIDIA 모델"),
    rank("NVIDIA 모델 " + "모델 ".repeat(300)),
  );
  const hit = rank("모델").find((x) => x.candidate.id === "repeated")!;
  const normal = rank("모델").find((x) => x.candidate.id === "normal")!;
  assert.ok(hit.bm25 / normal.bm25 < 2.2, "term frequency must saturate");
});
test("Korean particles, punctuation and registered aliases connect cross-session provider changes", () => {
  const corpus = [
    doc("provider", "엔비디아로 호출한다", {
      aliases: ["NVIDIA"],
      subject: "AI Provider",
      scope: "curation",
    }),
    doc("unrelated", "화면 여백", { same_session: true }),
  ];
  assert.ok(lexicalTerms("NVIDIA를, 알리바바로").includes("nvidia"));
  const result = rankKnowledgeCandidates(
    corpus,
    "NVIDIA를 취소하고 Alibaba로 AI Provider를 변경하자.",
  );
  assert.equal(result.ranked[0].candidate.id, "provider");
  assert.ok(result.ranked[0].reasons.includes("alias"));
  assert.ok(!result.ranked.some((hit) => hit.candidate.id === "unrelated"));
});
test("late chunk topics are retained and long query is not cut at first words", () => {
  const corpus = [
    doc("db", "PostgreSQL 운영 데이터베이스"),
    doc("provider", "NVIDIA 정제 모델"),
  ];
  const result = rankKnowledgeCandidates(
    corpus,
    "화면 여백을 맞춘다. ".repeat(5000) +
      " NVIDIA 정제 모델을 Alibaba로 변경하자.",
  );
  assert.deepEqual(
    result.ranked.map((hit) => hit.candidate.id),
    ["provider"],
  );
});
test("field reranking and coverage preserve several agendas without newest-session preference", () => {
  const corpus = [
    doc("db", "PostgreSQL", { subject: "database" }),
    doc("p1", "NVIDIA", { subject: "provider" }),
    doc("p2", "NVIDIA", { subject: "provider", same_session: true }),
  ];
  const result = rankKnowledgeCandidates(
    corpus,
    "provider NVIDIA database PostgreSQL",
  );
  assert.equal(
    new Set(result.ranked.slice(0, 2).map((hit) => hit.candidate.subject)).size,
    2,
  );
  assert.ok(result.ranked.every((hit) => hit.reasons.includes("subject")));
});
test("no lexical match returns no candidates; deictic hints never select one of several antecedents", () => {
  const corpus = [
    doc("a", "NVIDIA", { same_session: true }),
    doc("b", "PostgreSQL", { same_session: true }),
  ];
  assert.equal(rankKnowledgeCandidates(corpus, "고양이 사료").ranked.length, 0);
  assert.equal(
    rankKnowledgeCandidates(corpus, "그거 취소하자").ranked.length,
    0,
  );
  assert.deepEqual(
    rankKnowledgeCandidates(corpus.slice(0, 1), "그거 취소하자").ranked[0]
      .reasons,
    ["ambiguous_session_reference"],
  );
});
test("candidate shortlist is bounded independently of corpus statistics", () => {
  const corpus = Array.from({ length: 40 }, (_, i) =>
    doc(String(i), "NVIDIA 모델 설정"),
  );
  const result = rankKnowledgeCandidates(corpus, "NVIDIA 모델");
  assert.equal(result.corpusSize, 40);
  assert.equal(result.matchedCandidates, 40);
  assert.equal(result.ranked.length, 24);
});
