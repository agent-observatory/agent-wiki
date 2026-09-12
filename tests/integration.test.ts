import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../apps/api/src/app.js";
import { pool, tx } from "../packages/core/src/db.js";
import { hash } from "../packages/core/src/storage.js";
import { processSource } from "../packages/core/src/ingest.js";
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

test("edits are revision-checked and glossary aliases are searchable", async () => {
  const r = await app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}/articles`,
    headers,
    payload: {
      title: "결제 멱등성 정책",
      content: "같은 멱등 키를 재사용합니다.",
      tags: ["결제"],
      folder: "payments",
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  article = r.json().id;
  const update = {
    title: "결제 멱등성 정책",
    content: "같은 키와 같은 요청이면 기존 결과를 반환합니다.",
    revision: 1,
  };
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/api/workspaces/${ws}/articles/${article}`,
        headers,
        payload: update,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/api/workspaces/${ws}/articles/${article}`,
        headers,
        payload: update,
      })
    ).statusCode,
    409,
  );
  await app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}/articles`,
    headers,
    payload: {
      title: "멱등성",
      content: "반복 요청은 같은 효과",
      kind: "glossary",
      aliases: ["idempotency"],
    },
  });
  const found = await app.inject({
    url: `/api/workspaces/${ws}/articles?q=idempotency`,
    headers,
  });
  assert.equal(found.statusCode, 200, found.body);
  assert.ok(found.json().items.some((a: { id: string }) => a.id === article));
  const rev = await app.inject({
    url: `/api/workspaces/${ws}/articles/${article}/revisions/1`,
    headers,
  });
  assert.equal(rev.json().content, "같은 멱등 키를 재사용합니다.");
});
test("workspace-bound read key returns citations but cannot write", async () => {
  const key = (
    await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws}/keys`,
      headers,
      payload: { name: "test", scope: "read" },
    })
  ).json();
  assert.ok(key.token);
  const auth = {
    authorization: "Bearer " + key.token,
    "content-type": "application/json",
  };
  const context = await app.inject({
    url: `/api/workspaces/${ws}/context?q=${encodeURIComponent("결제")}`,
    headers: auth,
  });
  assert.equal(context.statusCode, 200, context.body);
  assert.ok(
    context
      .json()
      .citations.some(
        (c: { id: string; revision: number }) =>
          c.id === article && c.revision === 2,
      ),
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws}/articles`,
        headers: auth,
        payload: { title: "bad", content: "" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/workspaces/${other}/context?q=test`,
        headers: auth,
      })
    ).statusCode,
    404,
  );
  await app.inject({
    method: "DELETE",
    url: `/api/workspaces/${ws}/keys/${key.id}`,
    headers,
    payload: {},
  });
  assert.equal(
    (await app.inject({ url: `/api/workspaces/${ws}/articles`, headers: auth }))
      .statusCode,
    401,
  );
});
test("source acceptance is idempotent; committed ingest is not applied twice; deletion hides derived knowledge", async () => {
  const payload = {
    name: "합성 메모",
    text: "사용자: 동일 결제에는 같은 키를 쓴다.",
    allowExternalAI: true,
  };
  const h = { ...headers, "idempotency-key": randomUUID() };
  const r = await app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}/sources`,
    headers: h,
    payload,
  });
  assert.equal(r.statusCode, 200, r.body);
  const id = r.json().id;
  const again = await app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}/sources`,
    headers: h,
    payload,
  });
  assert.equal(again.json().id, id);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws}/sources`,
        headers: h,
        payload: { ...payload, text: "different" },
      })
    ).statusCode,
    409,
  );
  let calls = 0;
  const fake = async () => {
    calls++;
    return {
      model: "synthetic",
      result: {
        title: "합성 정책",
        summary: "동일 결제에는 같은 키를 쓴다.",
        tags: ["결제"],
        memories: [
          {
            claim: "같은 키 사용",
            quote: "동일 결제에는 같은 키를 쓴다.",
            status: "user_confirmed" as const,
          },
        ],
      },
    };
  };
  const data = { sourceId: id, workspaceId: ws, userId: "test-owner" };
  await processSource(data, 0, new AbortController().signal, fake);
  await processSource(data, 1, new AbortController().signal, fake);
  assert.equal(calls, 1);
  const rows = await tx("test-owner", ws, (c) =>
    c.query("SELECT * FROM articles WHERE source_id=$1", [id]),
  );
  assert.equal(rows.rowCount, 2);
  await app.inject({
    method: "DELETE",
    url: `/api/workspaces/${ws}/sources/${id}`,
    headers,
    payload: {},
  });
  const hidden = await app.inject({
    url: `/api/workspaces/${ws}/articles/${rows.rows[0].id}`,
    headers,
  });
  assert.equal(hidden.statusCode, 404);
});
test("expired queue work becomes retryable in the UI; an old delivery cannot apply to a new attempt", async () => {
  const accepted = await app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}/sources`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {
      name: "종료 복구 검증",
      text: "합성 기록",
      allowExternalAI: true,
    },
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const id = accepted.json().id;
  const oldJob = (
    await admin.query("SELECT queue_job_id FROM sources WHERE id=$1", [id])
  ).rows[0].queue_job_id;
  await admin.query(
    "UPDATE pgboss.job SET state='failed',completed_on=now() WHERE id=$1",
    [oldJob],
  );
  const listing = await app.inject({
    url: `/api/workspaces/${ws}/sources`,
    headers,
  });
  assert.equal(
    listing.json().items.find((s: { id: string }) => s.id === id).status,
    "failed",
  );
  const retry = await app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}/sources/${id}/retry`,
    headers,
    payload: {},
  });
  assert.equal(retry.statusCode, 200, retry.body);
  let called = false;
  const shouldNotRun = async () => {
    called = true;
    throw new Error("Stale job must not call AI");
  };
  await processSource(
    { sourceId: id, workspaceId: ws, userId: "test-owner" },
    0,
    new AbortController().signal,
    shouldNotRun,
    oldJob,
  );
  assert.equal(called, false);
  const refreshed = await app.inject({
    url: `/api/workspaces/${ws}/sources`,
    headers,
  });
  assert.equal(
    refreshed.json().items.find((s: { id: string }) => s.id === id).status,
    "queued",
  );
});
