import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
import { pool } from "../packages/core/src/db.js";
import { hash } from "../packages/core/src/storage.js";
const owner = "claims-" + randomUUID(),
  token = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const headers = {
  cookie: "wiki_session=" + token,
  origin: "http://localhost:3000",
};
let app: Awaited<ReturnType<typeof buildApp>>, ws: string;
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  app = await buildApp();
  await app.ready();
  const r = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    headers,
    payload: { name: "Claim experiment" },
  });
  ws = r.json().id;
});
after(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
async function call(method: "GET" | "POST", path: string, payload?: any) {
  return app.inject({
    method,
    url: "/api/workspaces/" + ws + path,
    headers:
      method === "POST"
        ? { ...headers, "idempotency-key": randomUUID() }
        : headers,
    payload,
  });
}
async function proposal(text: string, opts: any = {}) {
  const s = await call("POST", "/source-records", {
    name: "Synthetic",
    text,
    kind: "note",
    origin: "test-" + randomUUID(),
  });
  assert.equal(s.statusCode, 200, s.body);
  const evidence = {
    sourceId: s.json().id,
    revision: 1,
    lines: [1, 1],
    quote: text,
  };
  return {
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [
      {
        clientRef: "decision",
        title: text,
        content: text,
        tags: ["experiment"],
        claims: [
          {
            anchor: "decision",
            text,
            type: "user_decision",
            subject: "database",
            scope: "production",
            state: "current",
            evidence: [evidence],
            ...opts,
          },
        ],
        claimRelations: [] as any[],
      },
    ],
  };
}
async function publish(p: any) {
  const r = await call("POST", "/publications", p);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().items[0].id as string;
}
function relate(p: any, id: string, relation = "supersedes") {
  p.changes[0].claimRelations = [
    {
      anchor: "decision",
      relation,
      target: { articleId: id, revision: 1, anchor: "decision" },
      evidence: structuredClone(p.changes[0].claims[0].evidence),
    },
  ];
}
test("current query follows explicit replacement; history retains evidence and immutable L1", async () => {
  const a = await proposal("Supabase를 운영 DB로 채택한다.");
  const old = await publish(a);
  const b = await proposal(
    "기존 선택을 취소하고 OCI PostgreSQL을 운영 DB로 채택한다.",
  );
  relate(b, old);
  const current = await publish(b);
  assert.equal(await publish(b), current, "idempotent retry");
  const stale = await proposal("현재 결정을 못 본 오래된 대상 변경");
  relate(stale, old);
  assert.equal(
    (await call("POST", "/publications", stale)).json().error,
    "CLAIM_TARGET_ALREADY_RETIRED",
  );
  const d = (await call("GET", "/articles/" + old)).json();
  assert.equal(d.claims[0].state, "superseded");
  assert.equal(d.content, a.changes[0].content);
  const result = (
    await call("GET", "/context?q=Supabase&tag=experiment")
  ).json();
  assert.ok(
    result.citations.some((c: any) => c.id === current),
    JSON.stringify(result),
  );
  assert.ok(!result.citations.some((c: any) => c.id === old));
  const history = (
    await call("GET", "/context?q=Supabase&tag=experiment&view=history")
  ).json();
  assert.ok(
    history.citations.some(
      (c: any) => c.id === old && c.claims[0].state === "superseded",
    ),
  );
  assert.ok(
    history.citations.some((c: any) =>
      c.claimRelations.some(
        (r: any) => r.target.articleId === old && r.target.revision === 1,
      ),
    ),
  );
  const sourceId = a.changes[0].claims[0].evidence[0].sourceId;
  assert.equal(
    (await call("GET", `/source-records/${sourceId}/revisions/1`)).json().text,
    a.changes[0].content,
  );
});
test("proposals, scopes, authority and unsupported relation evidence cannot retire a decision", async () => {
  const old = await publish(await proposal("검증용 기존 결정"));
  for (const [opts, code] of [
    [{ state: "proposed" }, "CLAIM_REPLACEMENT_NOT_CURRENT"],
    [{ scope: "local" }, "CLAIM_SCOPE_MISMATCH"],
    [{ type: "ai_inference" }, "DECISION_AUTHORITY_MISMATCH"],
  ] as const) {
    const p = await proposal("새 검토 의견", opts);
    relate(p, old);
    const r = await call("POST", "/publications", p);
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().error, code);
  }
  const invalid = await proposal("근거 없는 연결");
  relate(invalid, old);
  invalid.changes[0].claimRelations[0].evidence[0] = {
    ...invalid.changes[0].claimRelations[0].evidence[0],
    quote: "not provided",
  };
  assert.equal(
    (await call("POST", "/publications", invalid)).json().error,
    "CLAIM_RELATION_EVIDENCE_REQUIRED",
  );
  assert.equal(
    (await call("GET", "/articles/" + old)).json().claims[0].state,
    "current",
  );
  const proposed = await publish(
    await proposal("대안도 좋을까?", { state: "proposed" }),
  );
  assert.equal(
    (await call("GET", "/articles/" + proposed)).json().claims[0].state,
    "proposed",
  );
});
test("unresolved conflicts expose both sides and do not silently choose the newer statement", async () => {
  const old = await publish(await proposal("ConflictAlpha 사용"));
  const p = await proposal("ConflictBeta 사용");
  relate(p, old, "contradicts");
  const newer = await publish(p);
  for (const id of [old, newer])
    assert.equal(
      (await call("GET", "/articles/" + id)).json().claims[0].state,
      "conflicted",
    );
  const result = (
    await call("GET", "/context?q=ConflictAlpha&scope=production")
  ).json();
  assert.ok(
    result.citations.some(
      (c: any) => c.id === old && c.excerpt.includes("[미해결 충돌]"),
    ),
  );
  assert.ok(result.citations.some((c: any) => c.id === newer));
  const local = (
    await call("GET", "/context?q=ConflictAlpha&scope=local")
  ).json();
  assert.equal(local.citations.length, 0);
});

test("history follows fixed revisions even when the replacement is another version of the same article", async () => {
  const first = await proposal("VersionExample 이전 결정");
  const id = await publish(first);
  const next: any = await proposal("VersionExample 새로운 결정");
  next.changes[0].articleId = id;
  next.changes[0].baseRevision = 1;
  relate(next, id);
  await publish(next);
  const history = (
    await call("GET", "/context?q=VersionExample&view=history")
  ).json();
  assert.ok(
    history.citations.some(
      (c: any) =>
        c.id === id && c.revision === 1 && c.excerpt.includes("이전 결정"),
    ),
    JSON.stringify(history),
  );
  assert.ok(
    history.citations.some(
      (c: any) =>
        c.id === id && c.revision === 2 && c.excerpt.includes("새로운 결정"),
    ),
  );
  const invalid: any = await proposal("VersionExample 잘못된 자기 참조");
  invalid.changes[0].articleId = id;
  invalid.changes[0].baseRevision = 2;
  relate(invalid, id);
  invalid.changes[0].claimRelations[0].target.revision = 3;
  assert.equal(
    (await call("POST", "/publications", invalid)).json().error,
    "CLAIM_TARGET_NOT_PRIOR",
  );
});
