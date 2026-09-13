import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchTermGroups,
  searchPatterns,
} from "../packages/core/src/search-terms.js";
import { excerpt } from "../apps/agent-wiki-api/src/knowledge.js";

test("Korean spelling alternatives retain the original and count a repeated concept once", () => {
  assert.deepEqual(searchTermGroups("왜 PostgreSQL은 PostgreSQL 어디에?"), [
    ["postgresql은", "postgresql"],
  ]);
  assert.deepEqual(searchTermGroups("캐디 데이터"), [["캐디"], ["데이터"]]);
  assert.deepEqual(searchTermGroups("키워드는"), [["키워드는", "키워드"]]);
});

test("literal SQL wildcard characters and backslashes cannot broaden a query", () => {
  assert.deepEqual(searchPatterns("limit_% a\\b"), [
    ["%limit\\_\\%%"],
    ["%a\\\\b%"],
  ]);
  assert.equal(searchTermGroups("a1 a2 a3 a4 a5 a6 a7 a8 a9").length, 8);
});

test("Context excerpts find a Korean inflected query inside a long document", () => {
  const content =
    "관련 없는 서문. ".repeat(250) + "PostgreSQL을 OCI VM에 둔다.";
  const result = excerpt(content, "PostgreSQL은 어디에 둬?");
  assert.ok(result.text.includes("PostgreSQL을 OCI VM에 둔다."));
  assert.ok(result.start > 0);
  assert.equal(content.slice(result.start, result.end), result.text);
});

test("Context excerpts prefer the decision and reason together over an earlier isolated keyword", () => {
  const decision = "임베딩은 외부 API 비용 때문에 보류한다.";
  const content =
    "임베딩 참고 자료.\n" + "다른 주제 설명. ".repeat(300) + decision;
  const result = excerpt(content, "임베딩 비용");
  assert.ok(result.text.includes(decision));
  assert.equal(content.slice(result.start, result.end), result.text);
  assert.ok(result.text.length <= 1600);
  assert.equal(result.truncated, true);
});

test("Repeated keywords and spelling alternatives do not outweigh distinct query terms", () => {
  const decision = "PostgreSQL 저장소 비용을 함께 비교한다.";
  const content =
    "PostgreSQL은 PostgreSQL ".repeat(180) + "구분. ".repeat(400) + decision;
  const result = excerpt(content, "PostgreSQL은 비용", 300);
  assert.ok(result.text.includes(decision));
  assert.ok(result.text.length <= 300);
  assert.equal(content.slice(result.start, result.end), result.text);
  assert.equal(excerpt(content, "없는검색어", 300).start, 0);
  assert.equal(excerpt(content, "", 300).start, 0);
});
