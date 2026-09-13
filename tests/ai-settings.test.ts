import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
import { pool } from "../packages/core/src/db.js";
import { hash } from "../packages/core/src/storage.js";
import { defaults, decryptSecret } from "../packages/core/src/ai.js";

const owner = "ai-settings-" + randomUUID(),
  token = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let app: Awaited<ReturnType<typeof buildApp>>, ws: string;
const headers = {
  cookie: "wiki_session=" + token,
  origin: "http://localhost:3000",
  "content-type": "application/json",
};
const byok = {
  ...defaults,
  mode: "byok",
  provider: "openai-compatible",
  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  model: "qwen3.7-flash",
  maxInputTokens: 25000,
};
const free = { ...defaults, mode: "free" };
const endpoint = () => "/api/workspaces/" + ws + "/ai-settings";
const get = async () =>
  (await app.inject({ method: "GET", url: endpoint(), headers })).json();
const put = async (config: unknown, apiKey?: string) =>
  app.inject({
    method: "PUT",
    url: endpoint(),
    headers,
    payload: { config, apiKey, version: (await get()).version },
  });
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.AI_ALLOWED_HOSTS =
    "integrate.api.nvidia.com,dashscope-intl.aliyuncs.com";
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  app = await buildApp();
  ws = (
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers,
      payload: { name: "AI connection verification" },
    })
  ).json().id;
});
after(async () => {
  await app.close();
  await pool.end();
  await admin.end();
});

test("Free normalizes provider options; BYOK switching preserves separate encrypted credentials", async () => {
  // A pre-mode NVIDIA profile must also survive the first switch.
  assert.equal((await put(defaults, "synthetic-free-key")).statusCode, 200);
  assert.equal((await put(byok, "synthetic-byok-key")).statusCode, 200);
  let view = await get();
  assert.equal(view.mode, "byok");
  assert.equal(view.profiles.free.hasKey, true);
  assert.equal(view.profiles.byok.hasKey, true);
  assert.equal(JSON.stringify(view).includes("encrypted"), false);
  assert.equal(JSON.stringify(view).includes("synthetic-"), false);
  assert.equal((await put({ ...byok, mode: "free" })).statusCode, 200);
  view = await get();
  assert.equal(view.model, defaults.model);
  assert.equal(view.baseUrl, defaults.baseUrl);
  let row = (
    await admin.query("SELECT * FROM ai_settings WHERE workspace_id=$1", [ws])
  ).rows[0];
  assert.equal(decryptSecret(row.encrypted_key), "synthetic-free-key");
  assert.equal((await put(byok)).statusCode, 200);
  row = (
    await admin.query("SELECT * FROM ai_settings WHERE workspace_id=$1", [ws])
  ).rows[0];
  assert.equal(decryptSecret(row.encrypted_key), "synthetic-byok-key");
  assert.equal(row.config.enabled, false);
  assert.equal(row.config.maxInputTokens, 25000);
  const changedHost = await put({ ...byok, baseUrl: defaults.baseUrl });
  assert.equal(changedHost.statusCode, 400);
  assert.match(changedHost.body, /AI_KEY_REQUIRED/);
});

test("Hello tests unsaved settings, uses target credential, and never saves or queues curation", async () => {
  const original = globalThis.fetch;
  const before = await get();
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), byok.baseUrl + "/chat/completions");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer synthetic-byok-key",
    );
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "qwen3.7-flash-2026-07-15");
    assert.equal(body.max_tokens, 512);
    assert.equal(body.enable_thinking, false);
    assert.deepEqual(body.messages, [
      { role: "user", content: 'Reply with JSON only: {"message":"Hello"}' },
    ]);
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"message":"Hello"}' },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
      }),
    );
  };
  try {
    const r = await app.inject({
      method: "POST",
      url: endpoint() + "/test",
      headers,
      payload: {
        config: { ...byok, model: "qwen3.7-flash-2026-07-15" },
        version: before.version,
      },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().message, "Hello");
    assert.equal(r.json().usage.prompt_tokens, 20);
    assert.equal(calls, 1);
    assert.deepEqual(await get(), before);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM refinement_jobs WHERE workspace_id=$1",
          [ws],
        )
      ).rows[0].n,
      0,
    );
    const denied = await app.inject({
      method: "POST",
      url: endpoint() + "/test",
      headers,
      payload: {
        config: { ...byok, baseUrl: "https://evil.invalid/v1" },
        apiKey: "synthetic",
        version: before.version,
      },
    });
    assert.equal(denied.statusCode, 400);
    assert.equal(calls, 1);
    const unauthenticated = await app.inject({
      method: "POST",
      url: endpoint() + "/test",
      payload: { config: free, version: before.version },
    });
    assert.ok([401, 403].includes(unauthenticated.statusCode));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
