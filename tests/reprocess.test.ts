import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, putSource, getSource } from "../packages/core/src/storage.js";
import { defaults, encryptSecret } from "../packages/core/src/ai.js";
import {
  checkCurationControl,
  stopForQuota,
} from "../packages/core/src/curation-control.js";
import {
  runOne,
  instruction,
  PROMPT_VERSION,
} from "../apps/agent-wiki-worker/src/worker.js";
import { runReprocess } from "../apps/agent-wiki-worker/src/reprocess.js";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
const owner = "reprocess-" + randomUUID(),
  ws = randomUUID(),
  source = randomUUID(),
  job = randomUUID(),
  token = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let app: Awaited<ReturnType<typeof buildApp>>,
  objectKey: string,
  originalText: string;
const headers = {
  cookie: "wiki_session=" + token,
  origin: "http://localhost:3000",
  "content-type": "application/json",
};
const api = (path: string, payload?: any) =>
  app.inject({
    method: payload === undefined ? "GET" : "POST",
    url: `/api/workspaces/${ws}${path}`,
    headers,
    payload,
  });
const read = (sql: string, args: unknown[] = []) =>
  tx(owner, ws, (c) => c.query(sql, args));
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)",
    [ws, owner, "Synthetic reprocessing"],
  );
  originalText = [
    { event: 1, field: '["payload","role"]', text: "user" },
    {
      event: 1,
      field: '["payload","content"]',
      text: "운영 DB는 PostgreSQL을 사용한다. 기존 운영 경험이 있기 때문이다.",
    },
    { event: 1, field: '["timestamp"]', text: "2026-09-12T00:00:00Z" },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n");
  objectKey = ws + "/" + hash(originalText) + ".txt.gz";
  await putSource(objectKey, originalText);
  await read(
    "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'test','conversation','synthetic',$3,$3,$4,3,'test',true)",
    [source, ws, hash(originalText), objectKey],
  );
  await read(
    "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
    [job, ws, source],
  );
  await read(
    "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
    [
      ws,
      JSON.stringify({
        ...defaults,
        enabled: true,
        primary: { ...defaults.primary, maxInputTokens: 30000 },
        requestsPerMinute: 120,
      }),
      encryptSecret("synthetic"),
    ],
  );
  app = await buildApp();
});
after(async () => {
  await app.close();
  await pool.end();
  await admin.end();
});
const fake = (text: string) => async (_c: any, _k: any, m: any) => {
  const input = JSON.parse(m[1].content),
    record = input.source.records.find((r: any) =>
      r.text.includes("PostgreSQL"),
    );
  return {
    output: {
      changes: [
        {
          clientRef: "db",
          topic: { key: "infrastructure", title: "인프라" },
          title: "운영 DB",
          claims: [
            {
              anchor: "database",
              text,
              type: "user_decision",
              subject: "database",
              scope: "production",
              state: "current",
              evidence: [{ recordId: record.recordId }],
            },
          ],
        },
      ],
    },
    usage: { prompt_tokens: 100, completion_tokens: 30 },
  };
};
test("successful range can be reanalyzed as a review candidate, preserving coverage/history and explicit control", async () => {
  assert.equal(
    await runOne(
      owner,
      new AbortController().signal,
      fake("운영 DB는 PostgreSQL이다."),
    ),
    true,
  );
  const original = (
    await read("SELECT * FROM refinement_jobs WHERE id=$1", [job])
  ).rows[0];
  assert.equal(original.status, "completed");
  const before = (
    await read("SELECT * FROM articles WHERE workspace_id=$1", [ws])
  ).rows;
  assert.equal(before.length, 1);
  const planResponse = await api("/curation/reprocess/plan/" + original.run_id);
  assert.equal(planResponse.statusCode, 200, planResponse.body);
  const plan = planResponse.json();
  assert.equal(plan.source.text, undefined);
  await read(
    "UPDATE ai_settings SET config=jsonb_set(config,'{enabled}','false'),version=version+1 WHERE workspace_id=$1",
    [ws],
  );
  const payload = {
    requestId: randomUUID(),
    runId: original.run_id,
    fingerprint: plan.fingerprint,
    mode: "analyze",
    reason: "선택 이유 설명 보완",
  };
  const queued = await api("/curation/reprocess", payload);
  assert.equal(queued.statusCode, 200, queued.body);
  assert.equal(
    (await api("/curation/reprocess", payload)).json().id,
    payload.requestId,
  );
  assert.equal(
    (await api("/curation/reprocess", { ...payload, reason: "다른 요청" }))
      .statusCode,
    409,
  );
  let calls = 0;
  const model = async (...args: any[]) => {
    calls++;
    return (
      fake("운영 DB는 기존 운영 경험이 있는 PostgreSQL을 사용한다.") as any
    )(...args);
  };
  assert.equal(
    await runReprocess(
      owner,
      new AbortController().signal,
      instruction,
      PROMPT_VERSION,
      model,
    ),
    false,
  );
  assert.equal(calls, 0);
  await read(
    "UPDATE ai_settings SET config=jsonb_set(config,'{enabled}','true'),version=version+1 WHERE workspace_id=$1",
    [ws],
  );
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  assert.equal(
    await runReprocess(
      owner,
      new AbortController().signal,
      instruction,
      PROMPT_VERSION,
      model,
    ),
    true,
  );
  assert.equal(calls, 1);
  const ready = (await api("/curation/reprocess/" + payload.requestId)).json();
  assert.equal(ready.status, "ready", JSON.stringify(ready));
  assert.deepEqual(
    (await read("SELECT * FROM articles WHERE workspace_id=$1", [ws])).rows,
    before,
  );
  assert.deepEqual(
    (await read("SELECT * FROM refinement_jobs WHERE id=$1", [job])).rows[0],
    original,
  );
  assert.equal(hash(await getSource(objectKey)), hash(originalText));
  const change = {
    ...ready.candidate.changes[0],
    articleId: before[0].id,
    baseRevision: before[0].revision,
  };
  const apply = {
    fingerprint: plan.fingerprint,
    publication: {
      idempotencyKey: randomUUID(),
      producer: { type: "agent", client: "synthetic-test" },
      reason: "원래 결정의 추출 설명 정정",
      changes: [change],
    },
  };
  const result = await api(
    "/curation/reprocess/" + payload.requestId + "/apply",
    apply,
  );
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(
    (
      await api("/curation/reprocess/" + payload.requestId + "/apply", apply)
    ).json(),
    result.json(),
  );
  assert.equal(
    (await read("SELECT revision FROM articles WHERE id=$1", [before[0].id]))
      .rows[0].revision,
    2,
  );
  assert.equal(
    (
      await read("SELECT count(*)::int n FROM revisions WHERE article_id=$1", [
        before[0].id,
      ])
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await read(
        "SELECT count(*)::int n FROM knowledge_reviews WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0].n,
    0,
  );
  const first = await api("/wiki-pages/reassemble", {});
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().modelCalls, 0);
  assert.deepEqual(
    (await api("/wiki-pages/reassemble", {})).json().pages,
    first.json().pages,
  );
  assert.match(
    (await read("SELECT content FROM wiki_pages WHERE workspace_id=$1", [ws]))
      .rows[0].content,
    /기록 2026/,
  );
});
test("quota stop is version fenced and settings editing cannot start curation", async () => {
  let setting = (
    await read("SELECT version FROM ai_settings WHERE workspace_id=$1", [ws])
  ).rows[0];
  assert.equal(await checkCurationControl(owner, ws, setting.version), true);
  assert.equal(await stopForQuota(owner, ws, setting.version - 1), undefined);
  await stopForQuota(owner, ws, setting.version);
  assert.equal(await checkCurationControl(owner, ws, setting.version), false);
  const response = await api("/ai-settings"),
    data = response.json();
  assert.equal(data.enabled, false);
  assert.equal(data.stoppedReason, "AI_FREE_QUOTA_EXHAUSTED");
  const {
    version,
    hasKey,
    stoppedReason,
    stoppedAt,
    fallbackActive,
    fallbackActiveSince,
    activeModel,
    ...config
  } = data;
  const changed = await app.inject({
    method: "PUT",
    url: `/api/workspaces/${ws}/ai-settings`,
    headers,
    payload: { version, config: { ...config, enabled: true } },
  });
  assert.equal(changed.statusCode, 400, changed.body);
  assert.match(changed.body, /USE_CURATION_CONTROL/);
});

test("three identical output failures stop only that chunk without a fourth request", async () => {
  const extraSource = randomUUID(),
    extraJob = randomUUID();
  await read(
    "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'retry','conversation','synthetic-retry',$3,$3,$4,3,'retry',true)",
    [extraSource, ws, hash(originalText), objectKey],
  );
  await read(
    "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
    [extraJob, ws, extraSource],
  );
  await read(
    "UPDATE ai_settings SET config=jsonb_set(config,'{enabled}','true'),version=version+1 WHERE workspace_id=$1",
    [ws],
  );
  let calls = 0;
  const { ModelError } = await import("../packages/core/src/ai.js");
  for (let attempt = 1; attempt <= 3; attempt++) {
    await read("UPDATE refinement_jobs SET available_at=now() WHERE id=$1", [
      extraJob,
    ]);
    await admin.query(
      "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
      [owner],
    );
    assert.equal(
      await runOne(owner, new AbortController().signal, async () => {
        calls++;
        throw new ModelError("AI_INVALID_JSON");
      }),
      true,
    );
    const row = (
      await read("SELECT status,chunk_index FROM refinement_jobs WHERE id=$1", [
        extraJob,
      ])
    ).rows[0];
    assert.equal(row.status, attempt < 3 ? "pending" : "failed");
    assert.equal(row.chunk_index, 0);
  }
  assert.equal(
    await runOne(owner, new AbortController().signal, async () => {
      calls++;
      return { output: { changes: [] }, usage: {} };
    }),
    false,
  );
  assert.equal(calls, 3);
});

test("queued reanalysis does not block recovery of an expired normal job lease", async () => {
  const original = (
    await read("SELECT run_id FROM refinement_jobs WHERE id=$1", [job])
  ).rows[0];
  const plan = (
    await api("/curation/reprocess/plan/" + original.run_id)
  ).json();
  const requestId = randomUUID();
  const queued = await api("/curation/reprocess", {
    requestId,
    runId: original.run_id,
    fingerprint: plan.fingerprint,
    mode: "analyze",
    reason: "임대 복구 합성 검사",
  });
  assert.equal(queued.statusCode, 200, queued.body);
  await read(
    "UPDATE refinement_jobs SET status='running',lease_until=now()-interval '1 minute' WHERE workspace_id=$1 AND id<>$2",
    [ws, job],
  );
  let calls = 0;
  const fake = async () => {
    calls++;
    return { output: { changes: [] }, usage: {} };
  };
  assert.equal(await runOne(owner, new AbortController().signal, fake), false);
  assert.equal(
    (
      await read(
        "SELECT count(*)::int n FROM refinement_jobs WHERE workspace_id=$1 AND status='running'",
        [ws],
      )
    ).rows[0].n,
    0,
  );
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  assert.equal(
    await runReprocess(
      owner,
      new AbortController().signal,
      instruction,
      PROMPT_VERSION,
      fake,
    ),
    true,
  );
  assert.equal(calls, 1);
  assert.equal(
    (await api("/curation/reprocess/" + requestId)).json().status,
    "ready",
  );
});
