import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
import { pool } from "../packages/core/src/db.js";
import { hash } from "../packages/core/src/storage.js";
const fixtures = JSON.parse(
  await readFile(
    new URL("../experiments/retrieval/cases.json", import.meta.url),
    "utf8",
  ),
);
const owner = "retrieval-" + randomUUID(),
  token = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const headers = {
  cookie: "wiki_session=" + token,
  origin: "http://localhost:3000",
};
let app: Awaited<ReturnType<typeof buildApp>>, ws: string;
const ids = new Map<string, string>();
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  app = await buildApp();
  ws = (
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { name: "합성 검색 평가" },
    })
  ).json().id;
  for (const { key, ...payload } of fixtures.documents) {
    const r = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws}/articles`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { ...payload, kind: "memory", folder: "quality" },
    });
    assert.equal(r.statusCode, 200, r.body);
    ids.set(key, r.json().id);
  }
});
after(async () => {
  await app.close();
  await admin.end();
  await pool.end();
});
test("Korean personal-memory questions rank the relevant decision before single-word distractors", async () => {
  const results = [];
  for (const item of fixtures.queries) {
    const r = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws}/articles?q=${encodeURIComponent(item.q)}&pageSize=25`,
      headers,
    });
    assert.equal(r.statusCode, 200, r.body);
    const expectedIndex = r
      .json()
      .items.findIndex((a: any) => a.id === ids.get(item.expected));
    results.push({
      query: item.q,
      expected: item.expected,
      top:
        fixtures.documents.find(
          (d: any) => ids.get(d.key) === r.json().items[0]?.id,
        )?.key ?? null,
      passed: r.json().items[0]?.id === ids.get(item.expected),
      expectedRank: expectedIndex < 0 ? null : expectedIndex + 1,
    });
    if (!item.semantic) {
      const context = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws}/context?q=${encodeURIComponent(item.q)}`,
        headers,
      });
      assert.equal(context.statusCode, 200, context.body);
      assert.equal(context.json().citations[0]?.id, ids.get(item.expected));
      assert.ok(context.json().citations[0]?.url.includes("revision=1"));
    }
  }
  if (process.env.RETRIEVAL_REPORT)
    await writeFile(
      process.env.RETRIEVAL_REPORT,
      JSON.stringify(
        {
          cases: results.length,
          top1: results.filter((r) => r.passed).length,
          candidateHits: results.filter((r) => r.expectedRank !== null).length,
          results,
        },
        null,
        2,
      ) + "\n",
    );
  assert.ok(
    results
      .filter(
        (r) => !fixtures.queries.find((q: any) => q.q === r.query)?.semantic,
      )
      .every((r) => r.passed),
    JSON.stringify(results.filter((r) => !r.passed)),
  );
});

test("ranking retains tag and folder filters and does not treat wildcard input as browse", async () => {
  for (const [query, expected] of [
    ["q=임베딩&tag=search", ["embedding-decision"]],
    ["q=임베딩&folder=absent", []],
    ["q=limit_%", ["literal"]],
    ["q=없는검색어", []],
  ] as [string, string[]][]) {
    const r = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws}/articles?${encodeURI(query)}`,
      headers,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(
      r.json().items.map((a: any) => a.id),
      expected.map((key) => ids.get(key)),
    );
  }
});

test("the agent Context includes the decision reason from a later passage", async () => {
  const decision = "임베딩은 외부 API 비용 때문에 보류한다.";
  const article = await app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}/articles`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {
      title: "검색 검토 기록",
      content:
        "임베딩 참고 자료.\n" + "다른 주제 설명. ".repeat(300) + decision,
      kind: "memory",
      tags: ["excerpt-fixture"],
    },
  });
  assert.equal(article.statusCode, 200, article.body);
  const result = await app.inject({
    method: "GET",
    url: `/api/workspaces/${ws}/context?${new URLSearchParams({ q: "임베딩 비용", tag: "excerpt-fixture" })}`,
    headers,
  });
  assert.equal(result.statusCode, 200, result.body);
  const citation = result.json().citations[0];
  assert.equal(citation.id, article.json().id);
  assert.ok(citation.excerpt.includes(decision));
  assert.ok(citation.excerpt.length <= 1600);
  assert.ok(citation.url.includes("revision=1"));
});

test("a query with no searchable terms cannot turn into a workspace-wide recall", async () => {
  for (const q of ["왜?", "어디에", "???"]) {
    const search = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws}/articles?${new URLSearchParams({ q })}`,
      headers,
    });
    assert.equal(search.statusCode, 200, search.body);
    assert.deepEqual(search.json().items, []);
    assert.equal(search.json().pagination.hasNext, false);
    assert.equal(search.json().queryStatus, "needs_terms");
    const context = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws}/context?${new URLSearchParams({ q })}`,
      headers,
    });
    assert.equal(context.statusCode, 200, context.body);
    assert.deepEqual(context.json().citations, []);
    assert.deepEqual(context.json().topics, []);
    assert.equal(context.json().queryStatus, "needs_terms");
    assert.ok(context.json().notice.includes("핵심어"));
  }
  const browse = await app.inject({
    method: "GET",
    url: `/api/workspaces/${ws}/articles`,
    headers,
  });
  assert.ok(browse.json().items.length > 0);
  assert.equal(browse.json().queryStatus, "browse");
  const query = await app.inject({
    method: "GET",
    url: `/api/workspaces/${ws}/context?q=PostgreSQL`,
    headers,
  });
  assert.ok(query.json().citations.length > 0);
  assert.equal(query.json().queryStatus, "ready");
});
