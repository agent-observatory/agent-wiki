import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { buildApp } from "../apps/api/src/app.js";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, getSource } from "../packages/core/src/storage.js";
import {
  defaults,
  decryptSecret,
  ModelError,
} from "../packages/core/src/ai.js";
import { runOne } from "../apps/worker/src/worker.js";
const owner = "automation-" + randomUUID(),
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
const record = (text: string) =>
  JSON.stringify({
    type: "response_item",
    payload: { role: "user", content: text },
  });
const source = {
  machine: "synthetic-machine",
  client: "codex",
  sessionId: "synthetic-session",
  name: "합성 수집 검증",
  start: 0,
  records: [record("검증용 단일 VM을 사용한다.")],
};
async function request(
  method: any,
  path: string,
  payload?: unknown,
  h = headers,
) {
  return app.inject({
    method,
    url: "/api/workspaces/" + ws + path,
    headers: h,
    payload: payload as any,
  });
}
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  app = await buildApp();
  const r = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    headers,
    payload: { name: "Synthetic automation" },
  });
  ws = r.json().id;
});
after(async () => {
  await app.close();
  await pool.end();
  await admin.end();
});
test("server deduplicates overlap, reordered deliveries and changed content at the same position", async () => {
  const first = await request("POST", "/collection", source);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().accepted, 1);
  assert.equal(
    (await request("POST", "/collection", source)).json().accepted,
    0,
  );
  assert.equal(
    (
      await request("POST", "/collection", {
        ...source,
        start: 4,
        records: [record("먼저 도착한 다섯 번째 기록")],
      })
    ).json().accepted,
    1,
  );
  assert.equal(
    (
      await request("POST", "/collection", {
        ...source,
        records: [...source.records, record("나중에 도착한 두 번째 기록")],
      })
    ).json().accepted,
    1,
  );
  assert.equal(
    (
      await request("POST", "/collection", {
        ...source,
        records: [record("수정한 첫 번째 기록")],
      })
    ).json().accepted,
    1,
  );
  const stream = await tx(owner, ws, (c) =>
    c.query(
      "SELECT last_position FROM collection_streams WHERE workspace_id=$1",
      [ws],
    ),
  );
  assert.equal(stream.rows[0].last_position, 4);
  assert.equal(
    (await request("POST", "/collection", { ...source, records: ["{"] }))
      .statusCode,
    400,
  );
});
test("collection masks structured secrets and requires source-write scope; AI settings stay session-only", async () => {
  const r = await request("POST", "/collection", {
    ...source,
    start: 10,
    records: [JSON.stringify({ password: "synthetic-secret", text: "safe" })],
  });
  const row = (
    await tx(owner, ws, (c) =>
      c.query("SELECT object_key FROM sources WHERE id=$1", [
        r.json().sourceId,
      ]),
    )
  ).rows[0];
  assert.ok(!(await getSource(row.object_key)).includes("synthetic-secret"));
  const key = (
    await request("POST", "/keys", { name: "collector", scope: "source:write" })
  ).json().token;
  const bearer = {
    "content-type": "application/json",
    authorization: "Bearer " + key,
  } as any;
  assert.equal(
    (await request("POST", "/collection", { ...source, start: 11 }, bearer))
      .statusCode,
    200,
  );
  assert.equal(
    (await request("GET", "/ai-settings", undefined, bearer)).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "PUT",
        "/ai-settings",
        { config: defaults, version: 0 },
        bearer,
      )
    ).statusCode,
    403,
  );
});
test("settings encrypt keys, reject private endpoints and use optimistic versioning", async () => {
  assert.equal(
    (
      await request("PUT", "/ai-settings", {
        config: { ...defaults, baseUrl: "http://127.0.0.1" },
        version: 0,
      })
    ).statusCode,
    400,
  );
  const secret = "synthetic-ai-secret";
  const r = await request("PUT", "/ai-settings", {
    config: { ...defaults, dailyCalls: 1 },
    apiKey: secret,
    version: 0,
  });
  assert.equal(r.statusCode, 200, r.body);
  const stored = (
    await tx(owner, ws, (c) =>
      c.query("SELECT encrypted_key FROM ai_settings WHERE workspace_id=$1", [
        ws,
      ]),
    )
  ).rows[0].encrypted_key;
  assert.ok(!stored.includes(secret));
  assert.equal(decryptSecret(stored), secret);
  const read = await request("GET", "/ai-settings");
  assert.ok(!read.body.includes(secret));
  assert.equal(read.json().hasKey, true);
  assert.equal(
    (await request("PUT", "/ai-settings", { config: defaults, version: 0 }))
      .statusCode,
    409,
  );
});
test("disabled worker makes no calls; enabled publication preserves exact evidence and daily budget", async () => {
  let calls = 0;
  const model = async (_config: any, _key: string, messages: any) => {
    calls++;
    const input = JSON.parse(messages[1].content);
    return {
      output: {
        changes: [
          {
            clientRef: "decision",
            title: "검증 결정",
            content: "단일 VM을 사용한다.",
            kind: "memory",
            claims: [
              {
                anchor: "one",
                text: "단일 VM을 사용한다.",
                type: "user_decision",
                evidence: [
                  {
                    sourceId: input.source.id,
                    revision: 1,
                    lines: [1, 1],
                    quote: input.source.text.split("\n")[0],
                  },
                ],
              },
            ],
          },
        ],
      },
      usage: { total_tokens: 100 },
    };
  };
  assert.equal(await runOne(owner, new AbortController().signal, model), false);
  assert.equal(calls, 0);
  assert.equal(
    (
      await request("PUT", "/ai-settings", {
        config: { ...defaults, enabled: true, dailyCalls: 1 },
        version: 1,
      })
    ).statusCode,
    200,
  );
  assert.equal(await runOne(owner, new AbortController().signal, model), true);
  assert.equal(calls, 1);
  const state = (await request("GET", "/refinements")).json();
  const job = state.items.find((x: any) => x.status === "completed");
  assert.ok(job);
  assert.equal(job.result.items.length, 1);
  assert.equal(state.today.calls, 1);
  assert.equal(await runOne(owner, new AbortController().signal, model), false);
  assert.equal(calls, 1);
  const article = (
    await request("GET", "/articles/" + job.result.items[0].id)
  ).json();
  assert.equal(article.claims[0].evidence[0].source_id, job.source_id);
  assert.equal(article.producer.client, "remote-worker");
});
test("transient model errors are bounded and interrupted leases recover without losing work", async () => {
  await request("PUT", "/ai-settings", {
    config: { ...defaults, enabled: true, dailyCalls: 24 },
    version: 2,
  });
  let calls = 0;
  const failed = async () => {
    calls++;
    throw new ModelError("AI_HTTP_429", true, 30);
  };
  await runOne(owner, new AbortController().signal, failed);
  const row = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM refinement_jobs WHERE workspace_id=$1 AND error_code='AI_HTTP_429'",
        [ws],
      ),
    )
  ).rows[0];
  assert.equal(row.status, "pending");
  assert.ok(new Date(row.available_at) > new Date());
  await tx(owner, ws, async (c) => {
    await c.query(
      "UPDATE refinement_jobs SET status='failed' WHERE workspace_id=$1 AND id<>$2 AND status='pending'",
      [ws, row.id],
    );
    await c.query(
      "UPDATE refinement_jobs SET status='running',lease_until=now()-interval '1 second',attempts=2,available_at=now() WHERE id=$1",
      [row.id],
    );
  });
  await runOne(owner, new AbortController().signal, failed);
  const end = (
    await tx(owner, ws, (c) =>
      c.query("SELECT status,attempts FROM refinement_jobs WHERE id=$1", [
        row.id,
      ]),
    )
  ).rows[0];
  assert.equal(end.status, "failed");
  assert.equal(end.attempts, 3);
  assert.equal(calls, 2);
});
