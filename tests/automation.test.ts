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
test("transient errors pause the key without exhausting jobs and expired leases remain recoverable", async () => {
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
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
  // Other ready jobs must not issue requests during the shared cooldown.
  assert.equal(
    await runOne(owner, new AbortController().signal, failed),
    false,
  );
  assert.equal(calls, 1);
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
  // Lease recovery itself does not immediately replay an interrupted request.
  assert.equal(
    await runOne(owner, new AbortController().signal, failed),
    false,
  );
  await admin.query(
    "UPDATE refinement_jobs SET available_at=now() WHERE id=$1",
    [row.id],
  );
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  await runOne(owner, new AbortController().signal, failed);
  const end = (
    await tx(owner, ws, (c) =>
      c.query("SELECT status,attempts FROM refinement_jobs WHERE id=$1", [
        row.id,
      ]),
    )
  ).rows[0];
  assert.equal(end.status, "pending");
  assert.equal(end.attempts, 3);
  assert.equal(calls, 2);
  for (let i = 0; i < 3; i++) {
    await admin.query(
      "UPDATE refinement_jobs SET available_at=now() WHERE id=$1",
      [row.id],
    );
    await admin.query(
      "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
      [owner],
    );
    await runOne(owner, new AbortController().signal, failed);
  }
  const stillPending = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT status,attempts,chunk_index FROM refinement_jobs WHERE id=$1",
        [row.id],
      ),
    )
  ).rows[0];
  assert.equal(stillPending.status, "pending");
  assert.equal(stillPending.attempts, 6);
  assert.equal(stillPending.chunk_index, 0);
  assert.equal(calls, 5);
  const histories = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT diagnostics,error_code FROM refinement_runs WHERE job_id=$1 ORDER BY created_at",
        [row.id],
      ),
    )
  ).rows;
  assert.equal(histories.length, 5);
  assert.equal(histories[0].diagnostics.httpStatus, 429);
  assert.equal(histories[0].diagnostics.stage, "model");
  assert.ok(histories[0].diagnostics.retryDelaySeconds >= 120);
  assert.ok(histories[0].diagnostics.retryDelaySeconds <= 144);
  assert.ok(
    histories[4].diagnostics.retryDelaySeconds >
      histories[0].diagnostics.retryDelaySeconds,
  );
  assert.ok(
    histories.every(
      (r) =>
        r.diagnostics.requestedAt &&
        r.diagnostics.retryAt &&
        r.diagnostics.durationMs >= 0,
    ),
  );
  const exposed = (await request("GET", "/refinements")).json();
  assert.ok(
    exposed.health.errors.some(
      (e: any) => e.error_code === "AI_HTTP_429" && e.count === 5,
    ),
  );
});

test("collection rate limits do not consume the interactive API budget", async () => {
  for (let i = 0; i < 125; i++) {
    const response = await request("POST", "/collection", source);
    assert.equal(response.statusCode, 200);
  }
  assert.equal((await request("GET", "/ai-settings")).statusCode, 200);
});

test("progress totals cover all workspace jobs, not just the displayed 100, without exposing credentials", async () => {
  await tx(owner, ws, (c) =>
    c.query(
      `WITH copied AS (
      INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked)
      SELECT gen_random_uuid(),$1,'Progress sample','conversation','synthetic',s.content_hash,s.payload_hash,s.object_key,s.line_count,'progress-'||n,true
      FROM (SELECT * FROM sources WHERE workspace_id=$1 LIMIT 1) s CROSS JOIN generate_series(1,101) n RETURNING id
    ) INSERT INTO refinement_jobs(id,workspace_id,source_id,chunk_index,chunk_count)
      SELECT gen_random_uuid(),$1,id,1,2 FROM copied`,
      [ws],
    ),
  );
  const response = await request("GET", "/refinements");
  assert.equal(response.statusCode, 200, response.body);
  const data = response.json();
  const actual = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT count(*)::int AS total,sum(chunk_index)::int AS done,sum(chunk_count)::int AS chunks FROM refinement_jobs WHERE workspace_id=$1",
        [ws],
      ),
    )
  ).rows[0];
  assert.equal(data.items.length, 25);
  const second = (await request("GET", "/refinements?jobsPage=2")).json();
  assert.equal(second.items.length, 25);
  assert.equal(second.progress.summary.total, data.progress.summary.total);
  assert.ok(
    second.items.every((x: any) => !data.items.some((y: any) => x.id === y.id)),
  );
  assert.equal(data.progress.summary.total, actual.total);
  assert.equal(data.progress.summary.chunks_done, actual.done);
  assert.equal(data.progress.summary.chunks_total, actual.chunks);
  assert.ok(data.progress.summary.unplanned > 0);
  assert.equal(data.progress.schedule.reason, "provider_cooldown");
  assert.ok(data.progress.schedule.nextAttemptAt);
  assert.ok(!response.body.includes("encrypted_key"));
  assert.ok(!response.body.includes("key_hash"));
});

test("live pause/resume changes only enabled, preserves drafts through versions, and keeps admitted work safe", async () => {
  const current = (await request("GET", "/ai-settings")).json();
  const config = { ...defaults, enabled: true, dailyCalls: 1000 };
  await request("PUT", "/ai-settings", { config, version: current.version });
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  await admin.query(
    "UPDATE refinement_jobs SET available_at=now()+interval '1 day' WHERE workspace_id=$1 AND status='pending'",
    [ws],
  );
  await request("POST", "/collection", {
    ...source,
    sessionId: "pause-control-session",
    start: 0,
  });
  const saved = (await request("GET", "/ai-settings")).json();
  let calls = 0;
  await runOne(owner, new AbortController().signal, async () => {
    calls++;
    const paused = await request("PATCH", "/ai-settings/enabled", {
      enabled: false,
      version: saved.version,
    });
    assert.equal(paused.statusCode, 200, paused.body);
    const state = (await request("GET", "/refinements")).json();
    assert.equal(state.progress.schedule.reason, "pausing");
    return { output: { changes: [] }, usage: { total_tokens: 1 } };
  });
  assert.equal(calls, 1);
  assert.equal(
    await runOne(owner, new AbortController().signal, async () => {
      throw new Error("must not call while paused");
    }),
    false,
  );
  const paused = (await request("GET", "/ai-settings")).json();
  assert.equal(paused.enabled, false);
  assert.equal(paused.dailyCalls, 1000);
  assert.equal(paused.model, config.model);
  assert.equal(paused.hasKey, true);
  assert.equal(
    (
      await request("PATCH", "/ai-settings/enabled", {
        enabled: true,
        version: saved.version,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request("PATCH", "/ai-settings/enabled", {
        enabled: true,
        version: paused.version,
      })
    ).statusCode,
    200,
  );
  const resumed = (await request("GET", "/ai-settings")).json();
  assert.equal(resumed.enabled, true);
  const key = (
    await request("POST", "/keys", { name: "read-only", scope: "read" })
  ).json().token;
  assert.equal(
    (
      await request(
        "PATCH",
        "/ai-settings/enabled",
        { enabled: false, version: resumed.version },
        {
          authorization: "Bearer " + key,
          "content-type": "application/json",
        } as any,
      )
    ).statusCode,
    403,
  );
  await request("PATCH", "/ai-settings/enabled", {
    enabled: false,
    version: resumed.version,
  });
});
