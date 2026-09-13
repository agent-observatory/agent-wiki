import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
import { pool, tx } from "../packages/core/src/db.js";
import { hash } from "../packages/core/src/storage.js";
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  max: 2,
});
let app: Awaited<ReturnType<typeof buildApp>>,
  ws: string,
  other: string,
  article: string;
const token = "synthetic-session-" + randomUUID();
const headers = {
  cookie: "wiki_session=" + token,
  origin: "http://localhost:3000",
  "content-type": "application/json",
};
before(async () => {
  process.env.OWNER_GITHUB_ID = "test-owner";
  process.env.AI_ENCRYPTION_KEY = "7".repeat(64);
  await admin.query(
    "INSERT INTO users(id,login) VALUES('test-owner','test-owner'),('other-owner','other-owner') ON CONFLICT DO NOTHING",
  );
  await admin.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,'test-owner',now()+interval '1 hour')",
    [hash(token)],
  );
  app = await buildApp();
  await app.ready();
  const r = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    headers,
    payload: { name: "Synthetic test " + randomUUID() },
  });
  assert.equal(r.statusCode, 200, r.body);
  ws = r.json().id;
  other = randomUUID();
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,'other-owner','Private')",
    [other],
  );
});
after(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
test("authentication, CSRF and Workspace isolation", async () => {
  assert.equal((await app.inject("/api/workspaces")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: { ...headers, origin: "https://attacker.invalid" },
        payload: { name: "x" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: `/api/workspaces/${other}/articles`, headers }))
      .statusCode,
    404,
  );
  const rows = await tx("test-owner", other, (c) =>
    c.query("SELECT * FROM articles"),
  );
  assert.equal(rows.rowCount, 0);
});
test("private wiki rejects existing non-owner sessions and API keys", async () => {
  const outsider = randomUUID();
  const outsiderKey = randomUUID();
  await admin.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,'other-owner',now()+interval '1 hour')",
    [hash(outsider)],
  );
  await admin.query(
    "INSERT INTO api_keys(id,token_hash,user_id,workspace_id,name,scope) VALUES($1,$2,'other-owner',$3,'synthetic','read')",
    [randomUUID(), hash(outsiderKey), other],
  );
  const denied = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    headers: { ...headers, cookie: "wiki_session=" + outsider },
    payload: { name: "Must not be created" },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().error, "OWNER_ONLY");
  const keyDenied = await app.inject({
    url: "/api/workspaces",
    headers: { authorization: "Bearer " + outsiderKey },
  });
  assert.equal(keyDenied.statusCode, 403);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*) FROM workspaces WHERE owner_id='other-owner' AND name='Must not be created'",
      )
    ).rows[0].count,
    "0",
  );
  assert.equal((await app.inject({ url: "/api/me", headers })).statusCode, 200);
});

test("OAuth checks the owner before creating a user or session", async () => {
  process.env.GITHUB_CLIENT_ID = "synthetic-client";
  process.env.GITHUB_CLIENT_SECRET = "synthetic-secret";
  const oauthApp = await buildApp();
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;
  try {
    await oauthApp.ready();
    oauthApp.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow = async () =>
      ({ token: { access_token: "synthetic-access" } }) as never;
    const before = await admin.query(
      "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM sessions) AS sessions",
    );
    globalThis.fetch = async () =>
      Response.json({ id: "outsider-oauth", login: "outsider" });
    const denied = await oauthApp.inject(
      "/api/auth/github/callback?code=synthetic",
    );
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error, "OWNER_ONLY");
    assert.equal(denied.headers["set-cookie"], undefined);
    assert.deepEqual(
      (
        await admin.query(
          "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM sessions) AS sessions",
        )
      ).rows,
      before.rows,
    );
    globalThis.fetch = async () =>
      Response.json({ id: "test-owner", login: "test-owner" });
    const accepted = await oauthApp.inject(
      "/api/auth/github/callback?code=synthetic",
    );
    assert.equal(accepted.statusCode, 302);
    assert.ok(String(accepted.headers["set-cookie"]).includes("wiki_session="));
  } finally {
    globalThis.fetch = originalFetch;
    await oauthApp.close();
  }
});

test("missing owner configuration fails closed including OAuth entry", async () => {
  delete process.env.OWNER_GITHUB_ID;
  const unconfigured = await buildApp();
  process.env.OWNER_GITHUB_ID = "test-owner";
  process.env.AI_ENCRYPTION_KEY = "7".repeat(64);
  try {
    for (const url of [
      "/api/me",
      "/api/workspaces",
      "/api/auth/github",
      "/api/auth/github/callback?code=synthetic",
    ]) {
      const r = await unconfigured.inject({ url, headers });
      assert.equal(r.statusCode, 503, url);
      assert.equal(r.json().error, "OWNER_NOT_CONFIGURED");
    }
    assert.equal((await unconfigured.inject("/healthz")).statusCode, 200);
  } finally {
    await unconfigured.close();
  }
});

const base = () => `/api/workspaces/${ws}`;
async function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  payload?: unknown,
  extra = {},
) {
  return app.inject({
    method,
    url: base() + path,
    headers: { ...headers, ...extra },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}
async function source(text = "첫째 근거\n둘째 근거", key = randomUUID()) {
  const r = await call(
    "POST",
    "/source-records",
    { name: "합성 기록", text, kind: "note", origin: "synthetic" },
    { "idempotency-key": key },
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
function publication(s: any, extra: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "test" },
    changes: [
      {
        clientRef: "m",
        title: "검증한 지식",
        content: "첫째 주장",
        tags: ["test-project"],
        claims: [
          {
            anchor: "c1",
            text: "첫째 주장",
            type: "observation",
            evidence: [
              {
                sourceId: s.id,
                revision: 1,
                lines: [1, 1],
                quote: s.text.split("\n")[0],
              },
            ],
          },
        ],
      },
    ],
    ...extra,
  };
}
test("source-only registration is immutable, normalized, idempotent and starts no queue", async () => {
  const key = randomUUID();
  const s = await source("첫 줄\r\napi_key=synthetic-secret", key);
  assert.equal(s.lineCount, 2);
  assert.ok(s.text.includes("[REDACTED]"));
  assert.equal(
    (await source("첫 줄\r\napi_key=synthetic-secret", key)).id,
    s.id,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/source-records",
        { name: "different", text: "changed" },
        { "idempotency-key": key },
      )
    ).statusCode,
    409,
  );
  const read = await call(
    "GET",
    `/source-records/${s.id}/revisions/1?start=2&end=2`,
  );
  assert.equal(read.json().text, "api_key=[REDACTED]");
  assert.equal(
    (await call("GET", `/source-records/${s.id}/revisions/1?start=3`))
      .statusCode,
    400,
  );
  assert.equal(
    (await admin.query("SELECT to_regnamespace('pgboss') AS schema")).rows[0]
      .schema,
    null,
  );
});
test("publication is atomic with multiple sources and supports replay without duplicate revisions", async () => {
  const s = await source();
  const s2 = await source("추가 근거");
  const p = publication(s);
  p.changes[0].claims[0].evidence.push({
    sourceId: s2.id,
    revision: 1,
    lines: [1, 1],
    quote: s2.text,
  });
  const results = await Promise.all([
    call("POST", "/publications", p),
    call("POST", "/publications", p),
  ]);
  for (const r of results) assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(results[0].json(), results[1].json());
  article = results[0].json().items[0].id;
  assert.equal(
    (await call("GET", `/publications/${p.idempotencyKey}`)).json().id,
    results[0].json().id,
  );
  const detail = (await call("GET", `/articles/${article}`)).json();
  assert.equal(detail.revision, 1);
  assert.equal(detail.claims[0].evidence.length, 2);
  assert.equal(detail.producer.type, "agent");
  assert.equal(detail.reviewed_at, null);
  assert.equal(
    (await call("POST", "/publications", { ...p, reason: "different" }))
      .statusCode,
    409,
  );
  const bad = publication(s);
  bad.changes.push({
    ...bad.changes[0],
    clientRef: "second",
    claims: [
      {
        ...bad.changes[0].claims[0],
        evidence: [
          { sourceId: s.id, revision: 1, lines: [1, 1], quote: "invented" },
        ],
      },
    ],
  });
  assert.equal((await call("POST", "/publications", bad)).statusCode, 400);
  assert.equal(
    (await call("GET", `/publications/${bad.idempotencyKey}`)).statusCode,
    404,
  );
});
test("new revisions, historical evidence, conflict and owner review are distinct", async () => {
  const s = await source();
  const p = publication(s);
  p.changes[0] = {
    ...p.changes[0],
    articleId: article,
    baseRevision: 1,
  } as any;
  let r = await call("POST", "/publications", p);
  assert.equal(r.statusCode, 200, r.body);
  r = await call("POST", "/publications", {
    ...p,
    idempotencyKey: randomUUID(),
  });
  assert.equal(r.statusCode, 409);
  const history = (
    await call("GET", `/articles/${article}/revisions/1`)
  ).json();
  assert.equal(history.revision, 1);
  assert.equal(history.currentRevision, 2);
  assert.equal(history.claims[0].evidence.length, 2);
  assert.equal(
    (
      await call("POST", `/articles/${article}/review`, {
        revision: 1,
        snapshotHash: "0".repeat(64),
        client: "codex",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call("POST", `/articles/${article}/review`, {
        revision: 2,
        snapshotHash: (
          await call("GET", `/articles/${article}/comparison`)
        ).json().snapshotHash,
        client: "codex",
      })
    ).statusCode,
    200,
  );
  assert.ok((await call("GET", `/articles/${article}`)).json().reviewed_at);
});
test("scoped keys allow only their operations and cannot claim human authorship", async () => {
  for (const scope of ["read", "source:write", "publish"]) {
    const k = (await call("POST", "/keys", { name: "test", scope })).json();
    assert.ok(k.token);
    const auth = { authorization: "Bearer " + k.token };
    assert.equal(
      (await call("GET", "/recall?tag=test-project", undefined, auth))
        .statusCode,
      200,
    );
    const s = await source();
    const p = publication(s);
    assert.equal(
      (await call("POST", "/publications", p, auth)).statusCode,
      scope === "publish" ? 200 : 403,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/publications",
          {
            ...p,
            idempotencyKey: randomUUID(),
            producer: { type: "human", client: "fake" },
          },
          auth,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/keys",
          { name: "forbidden", scope: "publish" },
          auth,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/workspaces/${other}/recall?tag=test-project`,
          headers: auth,
        })
      ).statusCode,
      404,
    );
  }
});
test("cross-workspace evidence cannot be attached even for another Workspace owned by the same user", async () => {
  const newWs = (
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers,
      payload: { name: "other owned" },
    })
  ).json().id;
  const s = await source();
  const r = await app.inject({
    method: "POST",
    url: `/api/workspaces/${newWs}/publications`,
    headers,
    payload: publication(s),
  });
  assert.equal(r.statusCode, 404, r.body);
});
test("recall uses an explicit start page, search finds later text and pins citations", async () => {
  const s = await source();
  const p = publication(s, {
    startContext: { tag: "test-project", articleRef: "m" },
  });
  p.changes[0].content = "가".repeat(5000) + " 첫째 주장 검색후반";
  const r = await call("POST", "/publications", p);
  assert.equal(r.statusCode, 200, r.body);
  const context = (
    await call("GET", "/context?q=" + encodeURIComponent("검색후반"))
  ).json();
  assert.ok(context.citations[0].excerpt.includes("검색후반"));
  assert.ok(context.citations[0].url.includes("?revision=1"));
  const recall = (await call("GET", "/recall?tag=test-project")).json();
  assert.equal(recall.citations[0].id, r.json().items[0].id);
  assert.equal(recall.startContextMissing, false);
  assert.equal(
    (await call("GET", "/recall?tag=unknown")).json().startContextMissing,
    true,
  );
});
test("source deletion marks missing evidence without cascading into knowledge", async () => {
  const s = await source();
  const r = await call("POST", "/publications", publication(s));
  const id = r.json().items[0].id;
  assert.equal(
    (await call("DELETE", `/source-records/${s.id}`, {})).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", `/source-records/${s.id}/revisions/1`)).statusCode,
    404,
  );
  const detail = (await call("GET", `/articles/${id}`)).json();
  assert.equal(detail.claims[0].evidence[0].unavailable, true);
  assert.equal(
    (await call("POST", "/publications", publication(s))).statusCode,
    404,
  );
  assert.equal(
    (await call("DELETE", `/articles/${id}`, { revision: 1 })).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", `/articles/${id}/revisions/1`)).statusCode,
    404,
  );
});
test("human edits use publication validation and never self-verify", async () => {
  const r = await call(
    "POST",
    "/articles",
    { title: "사람 메모", content: "메모 본문" },
    { "idempotency-key": randomUUID() },
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().claims[0].type, "author_statement");
  assert.equal(r.json().reviewed_at, null);
});
test("supersession preserves historical links, hides old recall and rejects cycles", async () => {
  const s = await source();
  const first = publication(s, {
    startContext: { tag: "cycle-test", articleRef: "m" },
  });
  first.changes[0].tags = ["cycle-test"];
  const old = (await call("POST", "/publications", first)).json().items[0].id;
  const p: any = publication(s);
  p.changes[0].supersedes = [old];
  p.changes[0].tags = ["cycle-test"];
  const r = await call("POST", "/publications", p);
  assert.equal(r.statusCode, 200, r.body);
  const newer = r.json().items[0].id;
  const recall = (await call("GET", "/recall?tag=cycle-test")).json();
  assert.equal(recall.startContextMissing, true);
  assert.ok(!recall.citations.some((x: any) => x.id === old));
  const cycle: any = publication(s);
  cycle.changes[0] = {
    ...cycle.changes[0],
    articleId: old,
    baseRevision: 1,
    supersedes: [newer],
  };
  assert.equal((await call("POST", "/publications", cycle)).statusCode, 400);
  const edit: any = publication(s);
  edit.changes[0] = { ...edit.changes[0], articleId: newer, baseRevision: 1 };
  assert.equal((await call("POST", "/publications", edit)).statusCode, 200);
  assert.equal(
    (await call("GET", `/articles/${newer}/revisions/1`)).json().links[0].id,
    old,
  );
  assert.deepEqual((await call("GET", `/articles/${newer}`)).json().links, []);
});
test("Context bounds provenance and marks deleted start pages missing", async () => {
  const s = await source();
  const p: any = publication(s, {
    startContext: { tag: "bounded", articleRef: "m" },
  });
  p.changes[0].tags = ["bounded"];
  p.changes[0].claims = Array.from({ length: 100 }, (_, i) => ({
    ...p.changes[0].claims[0],
    anchor: "claim-" + i,
  }));
  const r = await call("POST", "/publications", p);
  assert.equal(r.statusCode, 200, r.body);
  const context = (await call("GET", "/recall?tag=bounded")).json();
  assert.ok(JSON.stringify(context).length <= 16000);
  assert.equal(context.truncated, true);
  assert.equal(context.citations[0].claimsTruncated, true);
  await call("DELETE", `/articles/${r.json().items[0].id}`, { revision: 1 });
  assert.equal(
    (await call("GET", "/recall?tag=bounded")).json().startContextMissing,
    true,
  );
});

test("publication list uses the title at the recorded revision, not an internal client reference", async () => {
  const s = await source();
  const input = publication(s);
  input.changes[0].title = "그때의 제목";
  const created = await call("POST", "/publications", input);
  assert.equal(created.statusCode, 200, created.body);
  const item = created.json().items[0];
  await admin.query(
    "UPDATE articles SET title='현재의 다른 제목' WHERE workspace_id=$1 AND id=$2",
    [ws, item.id],
  );
  const result = await call("GET", "/publications");
  assert.equal(result.statusCode, 200, result.body);
  const found = result
    .json()
    .items.flatMap((p: any) => p.result.items)
    .find((a: any) => a.id === item.id);
  assert.equal(found.title, "그때의 제목");
  assert.equal(found.revision, 1);
});

test("management is Workspace-bound and settings writes stay paused", async () => {
  const k = (
    await call("POST", "/keys", { name: "synthetic manager", scope: "manage" })
  ).json();
  const manage = (method: any, path: string, payload?: any) =>
    app.inject({
      method,
      url: `/api/workspaces/${ws}${path}`,
      headers: {
        authorization: "Bearer " + k.token,
        "content-type": "application/json",
      },
      ...(payload ? { payload } : {}),
    });
  const settings = await manage("GET", "/ai-settings");
  assert.equal(settings.statusCode, 200, settings.body);
  assert.equal(
    (
      await app.inject({
        url: `/api/workspaces/${other}/ai-settings`,
        headers: { authorization: "Bearer " + k.token },
      })
    ).statusCode,
    404,
  );
  const { hasKey, version, profiles, freePreset, ...config } = settings.json();
  const save = await manage("PUT", "/ai-settings", {
    version,
    config: { ...config, enabled: false },
    apiKey: "synthetic-key-for-test",
  });
  assert.equal(save.statusCode, 200, save.body);
  assert.equal((await manage("GET", "/ai-settings")).json().enabled, false);
  assert.equal(
    (await manage("PATCH", "/ai-settings/enabled", { enabled: true, version }))
      .statusCode,
    409,
  );
});
test("review baseline uses last approved snapshot across intervening Versions", async () => {
  const s = await source();
  const first = await call("POST", "/publications", publication(s));
  const id = first.json().items[0].id;
  let diff = (await call("GET", `/articles/${id}/comparison`)).json();
  assert.equal(diff.baseline.kind, "empty");
  const approval = {
    revision: 1,
    snapshotHash: diff.snapshotHash,
    client: "claude",
    reason: "User reviewed synthetic decision",
  };
  const confirmed = await call("POST", `/articles/${id}/review`, approval);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(
    (await call("POST", `/articles/${id}/review`, approval)).json().reviewId,
    confirmed.json().reviewId,
  );
  assert.equal(
    (await call("GET", `/articles/${id}/comparison`)).json().reviewPending,
    false,
  );
  assert.deepEqual(
    (await call("GET", `/articles/${id}/comparison`)).json().changes.claims,
    [],
  );
  for (let revision = 1; revision < 3; revision++) {
    const p = publication(s);
    Object.assign(p.changes[0], {
      articleId: id,
      baseRevision: revision,
      title: "Changed concept " + revision,
    });
    const r = await call("POST", "/publications", p);
    assert.equal(r.statusCode, 200, r.body);
  }
  diff = (await call("GET", `/articles/${id}/comparison`)).json();
  assert.deepEqual(
    [diff.baseline.kind, diff.baseline.revision, diff.revision],
    ["reviewed", 1, 3],
  );
  assert.equal(diff.reviewPending, true);
  assert.equal(diff.changes.metadataChanged, true);
  assert.equal(
    (
      await call("POST", `/articles/${id}/review`, { ...approval, revision: 3 })
    ).json().error,
    "REVIEW_COMPARISON_CHANGED",
  );
  const queue = (await call("GET", "/reviews")).json();
  assert.ok(queue.items.some((a: any) => a.id === id));
});

test("new claim relations invalidate approval even when the target Version stays unchanged", async () => {
  const s = await source();
  const first = await call("POST", "/publications", publication(s));
  const id = first.json().items[0].id;
  const original = (await call("GET", `/articles/${id}/comparison`)).json();
  const approved = await call("POST", `/articles/${id}/review`, {
    revision: 1,
    snapshotHash: original.snapshotHash,
    client: "codex",
  });
  assert.equal(approved.statusCode, 200, approved.body);
  const second = await call("POST", "/publications", publication(s));
  const otherId = second.json().items[0].id;
  await admin.query(
    `INSERT INTO claim_relations(workspace_id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation,evidence,publication_id)
    SELECT a.workspace_id,a.article_id,a.revision,a.anchor,b.article_id,b.revision,b.anchor,'contradicts','[]'::jsonb,r.publication_id
    FROM claims a JOIN claims b ON b.workspace_id=a.workspace_id JOIN revisions r ON r.workspace_id=a.workspace_id AND r.article_id=a.article_id AND r.revision=a.revision
    WHERE a.workspace_id=$1 AND a.article_id=$2 AND b.article_id=$3 LIMIT 1`,
    [ws, otherId, id],
  );
  const changed = (await call("GET", `/articles/${id}/comparison`)).json();
  assert.equal(changed.revision, 1);
  assert.equal(changed.reviewPending, true);
  assert.equal(changed.changes.relations.added.length, 1);
  assert.equal(
    (
      await call("POST", `/articles/${id}/review`, {
        revision: 1,
        snapshotHash: original.snapshotHash,
        client: "codex",
      })
    ).json().error,
    "REVIEW_COMPARISON_CHANGED",
  );
  assert.ok(
    (await call("GET", "/reviews")).json().items.some((x: any) => x.id === id),
  );
  const key = (
    await call("POST", "/keys", {
      scope: "publish",
      name: "Worker cannot approve",
    })
  ).json();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws}/articles/${id}/review`,
        headers: {
          authorization: "Bearer " + key.token,
          "content-type": "application/json",
        },
        payload: {
          revision: 1,
          snapshotHash: changed.snapshotHash,
          client: "worker",
        },
      })
    ).statusCode,
    403,
  );
});
