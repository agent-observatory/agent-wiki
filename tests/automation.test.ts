import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, getSource, putSource } from "../packages/core/src/storage.js";
import {
  defaults,
  decryptSecret,
  ModelError,
} from "../packages/core/src/ai.js";
import { runOne } from "../apps/agent-wiki-worker/src/worker.js";
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
// Explicitly exercise configuration saving and user control as separate calls.
async function configureAndControl(payload: any) {
  const before = (await request("GET", "/ai-settings")).json();
  const saved = await request("PUT", "/ai-settings", {
    ...payload,
    config: { ...payload.config, enabled: before.enabled },
  });
  if (saved.statusCode !== 200 || payload.config.enabled === before.enabled)
    return saved;
  return request("PATCH", "/ai-settings/enabled", {
    enabled: payload.config.enabled,
    version: (await request("GET", "/ai-settings")).json().version,
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
            topic: { key: "synthetic-topic", title: "합성 검증 주제" },
            clientRef: "decision",
            title: "검증 결정",
            content: "단일 VM을 사용한다.",
            kind: "memory",
            claims: [
              {
                anchor: "one",
                text: "단일 VM을 사용한다.",
                type: "user_decision",
                evidence: [{ recordId: input.source.records[0].recordId }],
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
      await configureAndControl({
        config: {
          ...defaults,
          primary: { ...defaults.primary, maxInputTokens: 30000 },
          enabled: true,
          dailyCalls: 1,
        },
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
  // Earlier increments now finish together; this test owns its new pending input.
  await request("POST", "/collection", {
    ...source,
    sessionId: "retry-fixture",
  });
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  const configured = await configureAndControl({
    config: { ...defaults, enabled: true, dailyCalls: 24 },
    version: (await request("GET", "/ai-settings")).json().version,
  });
  assert.equal(configured.statusCode, 200, configured.body);
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
    histories.every(
      (r) =>
        r.diagnostics.retryDelaySeconds >= 120 &&
        r.diagnostics.retryDelaySeconds <= 144,
    ),
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
  const waiting = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT count(*)::int AS n FROM refinement_jobs WHERE workspace_id=$1 AND status<>'completed' AND chunk_count=0 AND batch_parent IS NULL AND input_sources IS NULL",
        [ws],
      ),
    )
  ).rows[0].n;
  assert.equal(data.progress.summary.unplanned, waiting);
  assert.equal(data.progress.schedule.reason, "provider_cooldown");
  assert.ok(data.progress.schedule.nextAttemptAt);
  assert.ok(!response.body.includes("encrypted_key"));
  assert.ok(!response.body.includes("key_hash"));
});

test("live pause/resume changes only enabled, preserves drafts through versions, and keeps admitted work safe", async () => {
  const current = (await request("GET", "/ai-settings")).json();
  const config = { ...defaults, enabled: true, dailyCalls: 1000 };
  await configureAndControl({ config, version: current.version });
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
  assert.equal(paused.primary.model, config.primary.model);
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

test("unlimited setting persists and processes work beyond the former daily cap", async () => {
  const current = (await request("GET", "/ai-settings")).json();
  const saved = await configureAndControl({
    config: { ...defaults, enabled: true, dailyCalls: null },
    version: current.version,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await request("GET", "/ai-settings")).json().dailyCalls, null);
  await admin.query(
    "UPDATE refinement_jobs SET available_at=now()+interval '1 day' WHERE workspace_id=$1 AND status='pending'",
    [ws],
  );
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  await request("POST", "/collection", {
    ...source,
    sessionId: "unlimited-test",
    start: 0,
  });
  const job = (
    await admin.query(
      "SELECT id FROM refinement_jobs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1",
      [ws],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO refinement_runs(id,workspace_id,job_id,settings,prompt_version,status,diagnostics) SELECT gen_random_uuid(),$1,$2,'{}','synthetic','failed','{\"httpRequests\":1}' FROM generate_series(1,25)",
    [ws, job],
  );
  let calls = 0;
  assert.equal(
    await runOne(owner, new AbortController().signal, async () => {
      calls++;
      return { output: { changes: [] }, usage: { total_tokens: 1 } };
    }),
    true,
  );
  assert.equal(calls, 1);
  const progress = (await request("GET", "/refinements")).json();
  assert.ok(progress.today.calls > 24);
  assert.equal(progress.progress.control.dailyCalls, null);
  const latest = (await request("GET", "/ai-settings")).json();
  await request("PATCH", "/ai-settings/enabled", {
    enabled: false,
    version: latest.version,
  });
});

test("Curation groups sessions before pagination and pages only selected session jobs", async () => {
  const space = (
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers,
      payload: { name: "Grouped curation" },
    })
  ).json().id;
  await tx(owner, space, async (c) => {
    await c.query(
      `WITH seeded AS (
      INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked)
      SELECT gen_random_uuid(),$1,'Session '||session,'conversation','codex:group-'||session,'hash','hash','unused',1,session||'-'||part,true
      FROM generate_series(0,26) session CROSS JOIN LATERAL generate_series(1,CASE WHEN session=0 THEN 30 ELSE 1 END) part
      RETURNING id,origin,idempotency_key
    ) INSERT INTO refinement_jobs(id,workspace_id,source_id,status,chunk_count,chunk_index,error_code)
      SELECT gen_random_uuid(),$1,id,
      CASE WHEN origin<>'codex:group-0' THEN 'pending' ELSE (ARRAY['pending','pending','running','failed','completed'])[(split_part(idempotency_key,'-',2)::int-1)%5+1] END,
      2,1,CASE WHEN origin='codex:group-0' AND (split_part(idempotency_key,'-',2)::int-1)%5=1 THEN 'AI_HTTP_429' END FROM seeded`,
      [space],
    );
  });
  const get = async (path: string) => {
    const r = await app.inject({
      method: "GET",
      url: `/api/workspaces/${space}` + path,
      headers,
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const first = await get("/refinement-sessions");
  assert.equal(first.total, 27);
  assert.equal(first.items.length, 25);
  assert.equal(first.pagination.hasNext, true);
  const session = first.items.find((x: any) => x.name === "Session 0");
  assert.deepEqual(
    [
      session.total,
      session.pending,
      session.running,
      session.failed,
      session.completed,
      session.retrying,
    ],
    [30, 12, 6, 6, 6, 6],
  );
  assert.equal(session.state, "attention");
  assert.equal(session.percent, null);
  const second = await get("/refinement-sessions?sessionsPage=2");
  assert.equal(second.items.length, 2);
  assert.equal(second.pagination.hasNext, false);
  assert.equal(
    new Set([...first.items, ...second.items].map((x: any) => x.id)).size,
    27,
  );
  const empty = await get("/refinement-sessions?sessionsPage=3");
  assert.equal(empty.total, 27);
  assert.equal(empty.items.length, 0);
  const jobs = await get(`/refinement-sessions/${session.id}/jobs`);
  const next = await get(
    `/refinement-sessions/${session.id}/jobs?detailPage=2`,
  );
  assert.equal(jobs.items.length, 25);
  assert.equal(next.items.length, 5);
  assert.equal(jobs.pagination.hasNext, true);
  assert.equal(next.pagination.hasNext, false);
  assert.equal(
    new Set([...jobs.items, ...next.items].map((x: any) => x.id)).size,
    30,
  );
  assert.ok(
    [...jobs.items, ...next.items].every(
      (x: any) =>
        x.name === "Session 0" && !("output" in x) && !("chunk_plan" in x),
    ),
  );
  assert.equal(
    (await request("GET", `/refinement-sessions/${session.id}/jobs`))
      .statusCode,
    404,
  );
  await tx(owner, space, (c) =>
    c.query(
      "UPDATE sources SET deleted_at=now() WHERE workspace_id=$1 AND id=$2",
      [space, jobs.items[0].source_id],
    ),
  );
  const changed = (await get("/refinement-sessions")).items.find(
    (x: any) => x.name === "Session 0",
  );
  assert.equal(changed.total, 29);
});

test("Worker anchors a quotation across consecutive transport fragments while preserving model output and L1", async () => {
  const current = (await request("GET", "/ai-settings")).json();
  await configureAndControl({
    config: { ...defaults, enabled: true, dailyCalls: null },
    version: current.version,
  });
  await admin.query(
    "UPDATE refinement_jobs SET available_at=now()+interval '1 day' WHERE workspace_id=$1 AND status='pending'",
    [ws],
  );
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  const quote = "단일 VM을 사용한다.";
  const raw = [quote.slice(0, 7), quote.slice(7)]
    .map((text, segment) =>
      JSON.stringify({
        event: 1,
        field: '["payload","content",0,"text"]',
        segment,
        text,
      }),
    )
    .join("\n");
  let sourceId = randomUUID();
  const objectKey = ws + "/" + hash(raw) + ".txt.gz";
  await putSource(objectKey, raw);
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'Exact anchor','conversation','codex:exact-quote-anchor',$3,$3,$4,2,$5,true)",
      [sourceId, ws, hash(raw), objectKey, randomUUID()],
    );
    await c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [randomUUID(), ws, sourceId],
    );
  });
  assert.equal(
    await runOne(
      owner,
      new AbortController().signal,
      async (_config, _secret, messages: any) => {
        const input = JSON.parse(messages[1].content);
        sourceId = input.source.id;
        return {
          output: {
            changes: [
              {
                topic: { key: "synthetic-topic", title: "합성 검증 주제" },
                clientRef: "anchored",
                title: "정확한 인용 위치",
                content: quote,
                kind: "memory",
                claims: [
                  {
                    anchor: "decision",
                    text: quote,
                    type: "agent_statement",
                    evidence: [{ sourceId, revision: 1, lines: [10], quote }],
                  },
                ],
              },
            ],
          },
          usage: { total_tokens: 20 },
        };
      },
    ),
    true,
  );
  const state = await tx(owner, ws, async (c) => ({
    run: (
      await c.query(
        "SELECT r.status,r.error_code,r.diagnostics,r.output FROM refinement_runs r JOIN refinement_jobs j ON j.id=r.job_id WHERE j.source_id=$1 ORDER BY r.created_at DESC LIMIT 1",
        [sourceId],
      )
    ).rows[0],
    evidence: (
      await c.query(
        "SELECT line_start,line_end,quote FROM evidence WHERE workspace_id=$1 AND source_id=$2",
        [ws, sourceId],
      )
    ).rows,
    source: (
      await c.query("SELECT object_key FROM sources WHERE id=$1", [sourceId])
    ).rows[0],
  }));
  assert.equal(state.run.status, "completed", state.run.error_code);
  assert.equal(state.run.diagnostics.anchoredEvidence, 1);
  assert.deepEqual(state.run.diagnostics.evidenceValidation, {
    checked: 1,
    matched: 1,
    mismatched: 0,
  });
  assert.deepEqual(
    state.run.output.changes[0].claims[0].evidence[0].lines,
    [10],
  );
  assert.deepEqual(state.evidence, [
    { line_start: 1, line_end: 2, quote: raw },
  ]);
  assert.equal(await getSource(state.source.object_key), raw);
});

test("Worker assigns distinct internal identifiers to unreferenced model duplicates", async () => {
  const current = (await request("GET", "/ai-settings")).json();
  await configureAndControl({
    config: { ...defaults, enabled: true, dailyCalls: null },
    version: current.version,
  });
  await admin.query(
    "UPDATE refinement_jobs SET available_at=now()+interval '1 day' WHERE workspace_id=$1 AND status='pending'",
    [ws],
  );
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  const quote = "단일 VM을 사용한다.";
  const raw = JSON.stringify({
    event: 1,
    field: '["payload","content",0,"text"]',
    text: quote,
  });
  let sourceId = randomUUID();
  const objectKey = ws + "/" + hash(raw) + ".txt.gz";
  await putSource(objectKey, raw);
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'Duplicate identifiers','conversation','codex:duplicate-identifiers',$3,$3,$4,1,$5,true)",
      [sourceId, ws, hash(raw), objectKey, randomUUID()],
    );
    await c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [randomUUID(), ws, sourceId],
    );
  });
  assert.equal(
    await runOne(
      owner,
      new AbortController().signal,
      async (_config, _secret, messages: any) => {
        const input = JSON.parse(messages[1].content);
        sourceId = input.source.id;
        const response = {
          output: {
            changes: [
              {
                topic: { key: "synthetic-topic", title: "합성 검증 주제" },
                clientRef: "anchored",
                title: "정확한 인용 위치",
                content: quote,
                kind: "memory",
                claims: [
                  {
                    anchor: "decision",
                    text: quote,
                    type: "agent_statement",
                    evidence: [{ sourceId, revision: 1, lines: [10], quote }],
                  },
                ],
              },
            ],
          },
          usage: { total_tokens: 20 },
        };
        const change = response.output.changes[0];
        change.claims.push({
          ...structuredClone(change.claims[0]),
          text: quote + " 추가 주장",
        });
        response.output.changes.push({
          ...structuredClone(change),
          title: "별도 지식",
        });
        return response;
      },
    ),
    true,
  );
  const state = await tx(owner, ws, async (c) => ({
    run: (
      await c.query(
        "SELECT r.status,r.error_code,r.diagnostics,r.output FROM refinement_runs r JOIN refinement_jobs j ON j.id=r.job_id WHERE j.source_id=$1 ORDER BY r.created_at DESC LIMIT 1",
        [sourceId],
      )
    ).rows[0],
    evidence: (
      await c.query(
        "SELECT line_start,line_end,quote FROM evidence WHERE workspace_id=$1 AND source_id=$2",
        [ws, sourceId],
      )
    ).rows,
    source: (
      await c.query("SELECT object_key FROM sources WHERE id=$1", [sourceId])
    ).rows[0],
  }));
  assert.equal(state.run.status, "completed", state.run.error_code);
  assert.equal(state.run.diagnostics.anchoredEvidence, 4);
  assert.equal(state.run.diagnostics.renamedReferences, 1);
  assert.equal(state.run.diagnostics.renamedAnchors, 2);
  assert.deepEqual(
    state.run.output.changes[0].claims[0].evidence[0].lines,
    [10],
  );
  assert.equal(state.evidence.length, 4);
  assert.ok(
    state.evidence.every(
      (e: any) => e.line_start === 1 && e.line_end === 1 && e.quote === raw,
    ),
  );
  assert.deepEqual(
    state.run.output.changes.map((c: any) => c.clientRef),
    ["anchored", "anchored"],
  );
  assert.deepEqual(
    state.run.output.changes[0].claims.map((c: any) => c.anchor),
    ["decision", "decision"],
  );
  assert.equal(await getSource(state.source.object_key), raw);
});

test("invalid JSON, quotations, scope and missing targets regenerate without replaying rejected output", async () => {
  const settings = (await request("GET", "/ai-settings")).json();
  await configureAndControl({
    config: { ...defaults, enabled: true, dailyCalls: null },
    version: settings.version,
  });
  await admin.query(
    "UPDATE refinement_jobs SET available_at=now()+interval '1 day' WHERE workspace_id=$1 AND status='pending'",
    [ws],
  );
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  const quote = "단일 VM으로 시작하자.";
  const raw = JSON.stringify({
    event: 1,
    field: '["payload","content",0,"text"]',
    text: quote,
  });
  const sourceId = randomUUID(),
    jobId = randomUUID();
  const objectKey = ws + "/" + hash(raw) + ".txt.gz";
  await putSource(objectKey, raw);
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'Evidence retry','conversation','codex:evidence-retry',$3,$3,$4,1,$5,true)",
      [sourceId, ws, hash(raw), objectKey, randomUUID()],
    );
    await c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [jobId, ws, sourceId],
    );
  });
  let calls = 0;
  const model = async (_config: unknown, _secret: string, messages: any) => {
    calls++;
    const input = JSON.parse(messages[1].content);
    if (calls === 1) {
      assert.equal(input.validationRetry, undefined);
      throw new ModelError("AI_INVALID_JSON");
    }
    assert.equal(
      input.validationRetry.reason,
      [
        "",
        "",
        "AI_INVALID_JSON",
        "EVIDENCE_MISMATCH",
        "AI_UNKNOWN_CLAIM_TARGET",
      ][calls],
    );
    assert.ok(input.validationRetry.previousRunId);
    if (calls === 3)
      assert.deepEqual(input.validationRetry.rejectedEvidence, [0]);
    return {
      output: {
        changes: [
          {
            topic: { key: "synthetic-topic", title: "합성 검증 주제" },
            clientRef: "retry",
            title: "합성 인용 재생성",
            content: quote,
            kind: "memory",
            claimRelations:
              calls === 3
                ? [
                    {
                      anchor: "decision",
                      relation: "supports",
                      target: { clientRef: "missing", anchor: "decision" },
                      evidence: [
                        { sourceId, revision: 1, lines: [1, 1], quote },
                      ],
                    },
                  ]
                : [],
            claims: [
              {
                anchor: "decision",
                text: quote,
                type: "agent_statement",
                subject: "different-subject",
                scope: "production",
                evidence: [
                  {
                    sourceId,
                    revision: 1,
                    lines: [1, 1],
                    quote:
                      calls === 2 ? "단일 서버로 운영하기로 결정했다." : quote,
                  },
                ],
              },
            ],
          },
        ],
      },
      usage: { total_tokens: 10 },
    };
  };
  // Two codes left this chain when the worker started dropping a cross-scope
  // relation instead of letting it fail the publish: CLAIM_SCOPE_MISMATCH,
  // which the worker now handles, and CLAIM_REPLACEMENT_NOT_CURRENT, which
  // needs a target sharing subject and scope and so cannot be reached from
  // this fixture's related context. Both gates stay pinned elsewhere —
  // tests/claim-relations.test.ts, tests/claim-authoring.test.ts and the
  // worker-side drop in tests/curation-improvements.test.ts.
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(
      await runOne(owner, new AbortController().signal, model),
      true,
    );
    const state = await tx(owner, ws, async (c) => ({
      job: (await c.query("SELECT * FROM refinement_jobs WHERE id=$1", [jobId]))
        .rows[0],
      runs: (
        await c.query(
          "SELECT * FROM refinement_runs WHERE job_id=$1 ORDER BY created_at",
          [jobId],
        )
      ).rows,
      evidence: (
        await c.query(
          "SELECT count(*)::int AS n FROM evidence WHERE source_id=$1",
          [sourceId],
        )
      ).rows[0].n,
      gate: (
        await c.query(
          "SELECT failures FROM model_request_gates WHERE owner_id=$1",
          [owner],
        )
      ).rows[0],
    }));
    assert.equal(state.job.status, "pending");
    assert.equal(
      state.job.error_code,
      [
        "AI_INVALID_JSON",
        "EVIDENCE_MISMATCH",
        "AI_UNKNOWN_CLAIM_TARGET",
      ][attempt],
    );
    assert.equal(
      state.job.output,
      null,
      "a known invalid payload must never enter publish-only recovery",
    );
    assert.equal(state.job.chunk_index, 0);
    assert.equal(state.evidence, 0);
    assert.equal(state.runs.length, attempt + 1);
    assert.equal(state.runs.at(-1).diagnostics.retryable, true);
    assert.equal(
      state.runs.at(-1).diagnostics.retryKind,
      attempt === 1 ? "evidence_regeneration" : "output_regeneration",
    );
    assert.ok(
      state.runs.at(-1).diagnostics.retryDelaySeconds >= 120 &&
        state.runs.at(-1).diagnostics.retryDelaySeconds <= 144,
    );
    assert.equal(
      state.gate.failures,
      0,
      "invalid output is not a provider outage",
    );
    assert.equal(
      await runOne(owner, new AbortController().signal, model),
      false,
      "respect the retry delay",
    );
    await admin.query(
      "UPDATE refinement_jobs SET available_at=now() WHERE id=$1",
      [jobId],
    );
    await admin.query(
      "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
      [owner],
    );
  }
  assert.equal(await runOne(owner, new AbortController().signal, model), true);
  assert.equal(calls, 4);
  const final = await tx(owner, ws, async (c) => ({
    job: (
      await c.query(
        "SELECT status,chunk_index FROM refinement_jobs WHERE id=$1",
        [jobId],
      )
    ).rows[0],
    evidence: (
      await c.query("SELECT quote FROM evidence WHERE source_id=$1", [sourceId])
    ).rows,
    runs: (
      await c.query(
        "SELECT status,output FROM refinement_runs WHERE job_id=$1 ORDER BY created_at",
        [jobId],
      )
    ).rows,
  }));
  assert.equal(final.job.status, "completed");
  assert.equal(final.job.chunk_index, 1);
  assert.deepEqual(final.evidence, [{ quote: raw }]);
  assert.deepEqual(
    final.runs.map((r) => r.status),
    ["failed", "failed", "failed", "completed"],
  );
  assert.equal(
    final.runs[1].output.changes[0].claims[0].evidence[0].quote,
    "단일 서버로 운영하기로 결정했다.",
  );
});

test("explicit publish-only retry reuses cached output without a model call", async () => {
  await admin.query(
    "UPDATE refinement_jobs SET available_at=now()+interval '1 day' WHERE workspace_id=$1 AND status='pending'",
    [ws],
  );
  const response = await request("POST", "/collection", {
    ...source,
    sessionId: randomUUID(),
    records: [record("Synthetic retry evidence.")],
  });
  assert.equal(response.statusCode, 200);
  const sourceId = response.json().sourceId;
  const { id: jobId } = (
    await admin.query("SELECT id FROM refinement_jobs WHERE source_id=$1", [
      sourceId,
    ])
  ).rows[0];
  await admin.query(
    "UPDATE refinement_jobs SET status='failed',error_code='AI_INVALID_OUTPUT' WHERE id=$1",
    [jobId],
  );
  assert.equal(
    (
      await request("POST", `/refinements/${jobId}/retry`, {
        reuseOutput: true,
      })
    ).statusCode,
    404,
  );
  const row = (
    await admin.query("SELECT object_key FROM sources WHERE id=$1", [sourceId])
  ).rows[0];
  const quote = await getSource(row.object_key);
  const payload = {
    idempotencyKey: "reuse-" + randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [
      {
        topic: { key: "synthetic-topic", title: "합성 검증 주제" },
        clientRef: "reuse",
        title: "Cached publication",
        content: "Synthetic claim",
        kind: "memory",
        claims: [
          {
            anchor: "claim",
            text: "Synthetic claim",
            type: "agent_statement",
            evidence: [
              {
                sourceId,
                revision: 1,
                lines: [1, quote.split("\n").length],
                quote,
              },
            ],
          },
        ],
      },
    ],
  };
  const priorRun = randomUUID();
  await admin.query(
    "INSERT INTO refinement_runs(id,workspace_id,job_id,settings,prompt_version,status) VALUES($1,$2,$3,$4,'fixture','failed')",
    [priorRun, ws, jobId, JSON.stringify(defaults)],
  );
  await admin.query(
    "UPDATE refinement_jobs SET output=$2,run_id=$3 WHERE id=$1",
    [jobId, JSON.stringify(payload), priorRun],
  );
  assert.equal(
    (
      await request("POST", `/refinements/${jobId}/retry`, {
        reuseOutput: true,
      })
    ).statusCode,
    200,
  );
  await runOne(owner, new AbortController().signal, async () => {
    throw new Error("must not call a model");
  });
  const run = (
    await admin.query(
      "SELECT status,diagnostics FROM refinement_runs WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1",
      [jobId],
    )
  ).rows[0];
  assert.equal(run.status, "completed");
  assert.equal(run.diagnostics.requestedAt, undefined);
  assert.equal(run.diagnostics.recoveryOf, priorRun);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM publications WHERE workspace_id=$1 AND idempotency_key=$2",
        [ws, payload.idempotencyKey],
      )
    ).rows[0].n,
    1,
  );
});

test("first-model quota exhaustion continues on the configured fallback model and stops only when that is exhausted too", async () => {
  const fallback = "deepseek-v4-flash-0731";
  const settings = (await request("GET", "/ai-settings")).json();
  await configureAndControl({
    config: {
      ...defaults,
      enabled: true,
      dailyCalls: null,
      fallback: { model: fallback },
    },
    version: settings.version,
  });
  await admin.query(
    "UPDATE refinement_jobs SET available_at=now()+interval '1 day' WHERE workspace_id=$1 AND status='pending'",
    [ws],
  );
  const releaseGate = () =>
    admin.query(
      "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
      [owner],
    );
  const makeJob = async () => {
    const raw = JSON.stringify({
      event: 1,
      field: '["payload","content",0,"text"]',
      text: "2번 모델로 이어간다.",
    });
    const sourceId = randomUUID(),
      jobId = randomUUID(),
      objectKey = ws + "/" + hash(raw) + ".txt.gz";
    await putSource(objectKey, raw);
    await tx(owner, ws, async (c) => {
      await c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'Fallback','conversation',$5,$3,$3,$4,1,$5,true)",
        [sourceId, ws, hash(raw), objectKey, "codex:fallback-" + jobId],
      );
      await c.query(
        "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
        [jobId, ws, sourceId],
      );
    });
    return jobId;
  };
  const calls: string[] = [];
  const model = async (config: any) => {
    calls.push(config.model);
    if (config.model === defaults.primary.model)
      throw new ModelError("AI_FREE_QUOTA_EXHAUSTED");
    return {
      output: { changes: [] },
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    };
  };
  const first = await makeJob();
  await releaseGate();
  assert.equal(await runOne(owner, new AbortController().signal, model), true);
  assert.deepEqual(calls, [defaults.primary.model, fallback]);
  const state = await tx(owner, ws, async (c) => ({
    job: (
      await c.query(
        "SELECT status,error_code FROM refinement_jobs WHERE id=$1",
        [first],
      )
    ).rows[0],
    run: (
      await c.query(
        "SELECT settings,diagnostics,status FROM refinement_runs WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1",
        [first],
      )
    ).rows[0],
    settings: (
      await c.query(
        "SELECT config,stopped_reason,fallback_active_since FROM ai_settings WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0],
  }));
  assert.equal(state.job.status, "completed", state.job.error_code);
  assert.equal(state.run.status, "completed");
  assert.equal(state.run.settings.model, fallback);
  assert.equal(state.run.settings.fallbackFrom, defaults.primary.model);
  assert.equal(state.run.diagnostics.fallback.from, defaults.primary.model);
  assert.equal(state.run.diagnostics.fallback.to, fallback);
  assert.equal(
    state.run.diagnostics.fallback.reason,
    "AI_FREE_QUOTA_EXHAUSTED",
  );
  assert.equal(state.run.diagnostics.httpRequests, 2);
  assert.ok(state.settings.fallback_active_since);
  assert.equal(state.settings.config.enabled, true);
  assert.equal(state.settings.stopped_reason, null);
  const shown = (await request("GET", "/ai-settings")).json();
  assert.equal(shown.fallbackActive, true);
  assert.equal(shown.activeModel, fallback);
  assert.equal(shown.fallback.model, fallback);
  // Later work starts on the fallback without spending a call on the first model.
  await makeJob();
  calls.length = 0;
  await releaseGate();
  assert.equal(await runOne(owner, new AbortController().signal, model), true);
  assert.deepEqual(calls, [fallback]);
  // Promoting the fallback (or naming a new one) returns to the first model.
  const {
    hasKey,
    version,
    stoppedReason,
    stoppedAt,
    fallbackActive,
    fallbackActiveSince,
    activeModel,
    ...config
  } = (await request("GET", "/ai-settings")).json();
  const promoted = await request("PUT", "/ai-settings", {
    version,
    config: {
      ...config,
      primary: { ...config.primary, model: fallback },
      fallback: null,
    },
  });
  assert.equal(promoted.statusCode, 200, promoted.body);
  const after = (await request("GET", "/ai-settings")).json();
  assert.equal(after.fallbackActive, false);
  assert.equal(after.activeModel, fallback);
  // Without a second model the existing safety stop applies unchanged.
  await makeJob();
  await releaseGate();
  assert.equal(
    await runOne(owner, new AbortController().signal, async () => {
      throw new ModelError("AI_FREE_QUOTA_EXHAUSTED");
    }),
    true,
  );
  const stopped = (await request("GET", "/ai-settings")).json();
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.stoppedReason, "AI_FREE_QUOTA_EXHAUSTED");
});
