import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { putSource, hash } from "../packages/core/src/storage.js";
import { defaults, encryptSecret, ModelError } from "../packages/core/src/ai.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import { runConsolidation } from "../apps/agent-wiki-worker/src/consolidate.js";
import { scheduleConsolidation } from "../packages/core/src/consolidation.js";
import { setTimeout as sleep } from "node:timers/promises";
// A false return can mean "nothing left to do" or "the shared model-call
// rate gate says wait" (packages/core/src/model-gate.ts) — the gate itself
// only sleeps once a Step actually needs the model. Retry a few times with a
// short pause instead of treating an early false as completion.
async function drive(
  owner: string,
  ws: string,
  topicKey: string,
  signal: AbortSignal,
  model: any,
) {
  for (let i = 0; i < 40; i++) {
    if (await runConsolidation(owner, signal, model)) continue;
    const job = (
      await tx(owner, ws, (c) =>
        c.query("SELECT status FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2", [ws, topicKey]),
      )
    ).rows[0];
    if (job?.status === "completed" || job?.status === "failed") return;
    await sleep(100);
  }
  throw new Error("consolidation job did not finish in time");
}
// The engine resolves two unrelated 'current' claims left by separate
// extractions into one current + one superseded via a mocked model call.
// docs/l2-l3-memory.md#job과-step.
const owner = "consolidation-engine-" + randomUUID(),
  ws = randomUUID(),
  topicKey = "consolidation-engine-topic",
  admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
before(async () => {
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)",
    [ws, owner, "Consolidation engine test"],
  );
  await admin.query(
    "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
    [
      ws,
      JSON.stringify({
        ...defaults,
        enabled: true,
        baseUrl: "https://api.deepseek.com/v1",
        requestsPerMinute: 120,
      }),
      encryptSecret("synthetic"),
    ],
  );
});
after(async () => {
  await pool.end();
  await admin.end();
});
async function source(text: string) {
  const id = randomUUID(),
    key = ws + "/" + hash(text) + ".txt.gz";
  await putSource(key, text);
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'test','conversation','synthetic',$3,$3,$4,1,$1::text,true)",
      [id, ws, hash(text), key],
    ),
  );
  return id;
}
function change(clientRef: string, text: string, sourceId: string) {
  return {
    topic: { key: topicKey, title: "통합 엔진 검증" },
    clientRef,
    title: text,
    content: text,
    kind: "memory",
    claims: [
      {
        anchor: "decision",
        text,
        type: "user_decision",
        subject: "cache",
        scope: "production",
        state: "current",
        evidence: [{ sourceId, revision: 1, lines: [1, 1], quote: text }],
      },
    ],
    claimRelations: [] as any[],
  };
}
async function publishManual(payload: any) {
  return tx(owner, ws, (c) =>
    publish(c, ws, payload, { userId: owner, scope: "manage" }),
  );
}
test("gather -> model -> validate -> publish resolves two unrelated current claims into one supersedes relation", async () => {
  const textA = "캐시는 Redis를 사용한다.",
    textB = "캐시는 Memcached로 바꾼다.";
  const srcA = await source(textA),
    srcB = await source(textB);
  // Two separate extractions leave two unrelated 'current' claims on the same
  // (subject, scope) — the exact ambiguity Consolidation exists to resolve.
  const a = await publishManual({
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [change("a", textA, srcA)],
  });
  const b = await publishManual({
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [change("b", textB, srcB)],
  });
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO consolidation_jobs(workspace_id,topic_key,trigger) VALUES($1,$2,'manual')",
      [ws, topicKey],
    ),
  );
  let modelCalls = 0;
  const model = async (_config: any, _secret: any, messages: any[]) => {
    modelCalls++;
    const input = JSON.parse(messages[1].content);
    assert.equal(input.groups.length, 1);
    const group = input.groups[0];
    assert.equal(group.subject, "cache");
    assert.equal(group.scope, "production");
    assert.equal(group.claims.length, 2);
    const from = group.claims.find((c: any) => c.text === textB);
    const target = group.claims.find((c: any) => c.text === textA);
    assert.ok(from && target);
    return {
      output: {
        relations: [
          {
            subject: "cache",
            scope: "production",
            from: { articleId: from.articleId, revision: from.revision, anchor: from.anchor },
            relation: "supersedes",
            target: { articleId: target.articleId, revision: target.revision, anchor: target.anchor },
            evidence: [{ recordId: from.evidence[0].recordId }],
          },
        ],
        leaveUnresolved: [],
      },
      usage: { total_tokens: 42 },
    };
  };
  const signal = new AbortController().signal;
  await drive(owner, ws, topicKey, signal, model);
  assert.equal(modelCalls, 1, "model is called exactly once for one topic");
  const job = (
    await tx(owner, ws, (c) =>
      c.query("SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2", [ws, topicKey]),
    )
  ).rows[0];
  assert.equal(job.status, "completed");
  assert.equal(job.steps.gather.status, "done");
  assert.equal(job.steps.model.status, "done");
  assert.equal(job.steps.validate.status, "done");
  assert.equal(job.steps.publish.status, "done");
  assert.equal(job.steps.publish.output.published, 1);
  const relation = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM claim_relations WHERE workspace_id=$1 AND from_article_id=$2 AND to_article_id=$3",
        [ws, b.items[0].id, a.items[0].id],
      ),
    )
  ).rows[0];
  assert.ok(relation, "the supersedes relation was written");
  assert.equal(relation.relation, "supersedes");
  const state = (
    await tx(owner, ws, (c) =>
      c.query(
        `SELECT CASE WHEN EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=$1 AND cr.to_article_id=$2 AND cr.to_revision=1 AND cr.to_anchor='decision' AND cr.relation='supersedes') THEN 'superseded' ELSE 'current' END AS state`,
        [ws, a.items[0].id],
      ),
    )
  ).rows[0];
  assert.equal(state.state, "superseded");
  const run = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM refinement_runs WHERE workspace_id=$1 AND kind='consolidation' AND consolidation_job_id=$2",
        [ws, job.id],
      ),
    )
  ).rows[0];
  assert.ok(run, "the model call is logged to refinement_runs for call-history accounting");
  assert.equal(run.status, "completed");
});
test("a topic with nothing to consolidate skips model/validate/publish without a model call", async () => {
  const idleTopic = "consolidation-engine-idle-topic";
  const src = await source("한 번만 등장하는 주장이다.");
  await publishManual({
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [
      {
        topic: { key: idleTopic, title: "미결 없음" },
        clientRef: "solo",
        title: "solo",
        content: "한 번만 등장하는 주장이다.",
        kind: "memory",
        claims: [
          {
            anchor: "decision",
            text: "한 번만 등장하는 주장이다.",
            type: "user_decision",
            subject: "solo-subject",
            scope: "local",
            state: "current",
            evidence: [{ sourceId: src, revision: 1, lines: [1, 1], quote: "한 번만 등장하는 주장이다." }],
          },
        ],
        claimRelations: [],
      },
    ],
  });
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO consolidation_jobs(workspace_id,topic_key,trigger) VALUES($1,$2,'manual')",
      [ws, idleTopic],
    ),
  );
  let called = false;
  const model = async () => {
    called = true;
    throw new Error("must not be called");
  };
  const signal = new AbortController().signal;
  await drive(owner, ws, idleTopic, signal, model);
  assert.equal(called, false);
  const job = (
    await tx(owner, ws, (c) =>
      c.query("SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2", [ws, idleTopic]),
    )
  ).rows[0];
  assert.equal(job.status, "completed");
  assert.equal(job.steps.gather.status, "done");
  assert.equal(job.steps.model.status, "skipped");
  assert.equal(job.steps.validate.status, "skipped");
  assert.equal(job.steps.publish.status, "skipped");
});
test("a trigger that arrives while a Job is still open rolls it into a fresh gather on completion, never a second Job row", async () => {
  const rerunTopic = "consolidation-engine-rerun-topic";
  const textA = "롤오버는 Redis를 사용한다.",
    textB = "롤오버는 Memcached로 바꾼다.";
  const srcA = await source(textA),
    srcB = await source(textB);
  const rerunChange = (clientRef: string, text: string, sourceId: string) => ({
    topic: { key: rerunTopic, title: "재실행 롤오버" },
    clientRef,
    title: text,
    content: text,
    kind: "memory",
    claims: [
      {
        anchor: "decision",
        text,
        type: "user_decision",
        subject: "rerun-subject",
        scope: "production",
        state: "current",
        evidence: [{ sourceId, revision: 1, lines: [1, 1], quote: text }],
      },
    ],
    claimRelations: [] as any[],
  });
  const a = await publishManual({
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [rerunChange("a", textA, srcA)],
  });
  const b = await publishManual({
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [rerunChange("b", textB, srcB)],
  });
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO consolidation_jobs(workspace_id,topic_key,trigger) VALUES($1,$2,'manual')",
      [ws, rerunTopic],
    ),
  );
  let modelCalls = 0;
  const model = async (_config: any, _secret: any, messages: any[]) => {
    modelCalls++;
    const input = JSON.parse(messages[1].content);
    const group = input.groups[0];
    const from = group.claims.find((c: any) => c.text === textB);
    const target = group.claims.find((c: any) => c.text === textA);
    return {
      output: {
        relations: [
          {
            subject: "rerun-subject",
            scope: "production",
            from: { articleId: from.articleId, revision: from.revision, anchor: from.anchor },
            relation: "supersedes",
            target: { articleId: target.articleId, revision: target.revision, anchor: target.anchor },
            evidence: [{ recordId: from.evidence[0].recordId }],
          },
        ],
        leaveUnresolved: [],
      },
      usage: { total_tokens: 1 },
    };
  };
  const signal = new AbortController().signal;
  // Advance exactly one Step (gather): the Job stays open (status 'pending',
  // not yet 'completed') with 'model' next.
  assert.equal(await runConsolidation(owner, signal, model), true);
  let job = (
    await tx(owner, ws, (c) =>
      c.query("SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2", [ws, rerunTopic]),
    )
  ).rows[0];
  assert.equal(job.status, "pending");
  assert.equal(job.current_step, "model");
  const firstGatherHash = job.steps.gather.input_hash;
  // A second trigger while the Job is still open only flags rerun_requested
  // (docs/l2-l3-memory.md#job과-step) — never a second row for this topic.
  await tx(owner, ws, (c) => scheduleConsolidation(c, ws, rerunTopic, "manual"));
  await drive(owner, ws, rerunTopic, signal, model);
  const rows = (
    await tx(owner, ws, (c) =>
      c.query("SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2", [ws, rerunTopic]),
    )
  ).rows;
  assert.equal(rows.length, 1, "no second Job row was created");
  job = rows[0];
  assert.equal(job.status, "completed");
  assert.equal(job.rerun_requested, false);
  // freshSteps() resets attempts to 0, so a bare count can't tell "ran once"
  // from "rolled over and ran again" — a changed input_hash can: the rolled-
  // over gather sees the resolved topic (one live claim, not two) and
  // necessarily freezes a different snapshot.
  assert.notEqual(
    job.steps.gather.input_hash,
    firstGatherHash,
    "gather re-ran for the rolled-over pass and froze a new snapshot",
  );
  // The rolled-over gather finds the ambiguity already resolved by the first
  // pass, so the second pass makes no further model call.
  assert.equal(modelCalls, 1);
  assert.equal(job.steps.model.status, "skipped");
});
test("a long extraction only vetoes an automatic Job for 10 minutes; manual ignores the veto entirely", async () => {
  // A concurrent 'running' refinement_jobs row is both the busy signal the
  // veto reads and part of the separate concurrency count; raise concurrency
  // so this test isolates the veto instead of tripping that other gate too.
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE ai_settings SET config=jsonb_set(config,'{concurrency}','2') WHERE workspace_id=$1",
      [ws],
    ),
  );
  const vetoTopic = "consolidation-engine-veto-topic";
  const textA = "베토는 A 값을 사용한다.",
    textB = "베토는 B 값으로 바꾼다.";
  const srcA = await source(textA),
    srcB = await source(textB);
  const vetoChange = (clientRef: string, text: string, sourceId: string) => ({
    topic: { key: vetoTopic, title: "10분 veto 검증" },
    clientRef,
    title: text,
    content: text,
    kind: "memory",
    claims: [
      {
        anchor: "decision",
        text,
        type: "user_decision",
        subject: "veto-subject",
        scope: "production",
        state: "current",
        evidence: [{ sourceId, revision: 1, lines: [1, 1], quote: text }],
      },
    ],
    claimRelations: [] as any[],
  });
  await publishManual({
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [vetoChange("a", textA, srcA)],
  });
  await publishManual({
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [vetoChange("b", textB, srcB)],
  });
  await tx(owner, ws, (c) => scheduleConsolidation(c, ws, vetoTopic, "cycle"));
  const busySource = randomUUID();
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'busy','conversation','veto-busy','veto-busy-hash','veto-busy-hash','unused',1,$1::text,true)",
      [busySource, ws],
    ),
  );
  const busyJob = randomUUID();
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id,status) VALUES($1,$2,$3,'running')",
      [busyJob, ws, busySource],
    ),
  );
  const signal = new AbortController().signal;
  const noModel = async () => {
    throw new Error("must not be called while vetoed");
  };
  assert.equal(
    await runConsolidation(owner, signal, noModel),
    false,
    "a freshly scheduled automatic Job is vetoed by the busy extraction lane",
  );
  let job = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2",
        [ws, vetoTopic],
      ),
    )
  ).rows[0];
  assert.equal(job.status, "pending");
  assert.deepEqual(job.steps, {}, "gather never ran while vetoed");
  // Backdate it past the 10-minute bound: the veto no longer applies.
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE consolidation_jobs SET created_at=now()-interval '11 minutes' WHERE workspace_id=$1 AND id=$2",
      [ws, job.id],
    ),
  );
  assert.equal(
    await runConsolidation(owner, signal, noModel),
    true,
    "a 10-minute-old automatic Job is admitted despite the still-busy lane",
  );
  job = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND id=$2",
        [ws, job.id],
      ),
    )
  ).rows[0];
  assert.equal(job.steps.gather.status, "done");
  await tx(owner, ws, (c) =>
    c.query("UPDATE refinement_jobs SET status='completed' WHERE id=$1", [
      busyJob,
    ]),
  );
  // This Job is left mid-flight (at 'model') on purpose — the point of this
  // test is admission, not resolution. Close it out so it cannot be picked up
  // by, and skew the model-call count of, a later test in this file.
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE consolidation_jobs SET status='completed' WHERE workspace_id=$1 AND id=$2",
      [ws, job.id],
    ),
  );
});
test("consolidation.auto=false still creates an automatic Job but never admits it; a manual Job on the same topic still runs", async () => {
  const autoOffWs = randomUUID();
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)",
    [autoOffWs, owner, "Consolidation auto off"],
  );
  await admin.query(
    "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
    [
      autoOffWs,
      JSON.stringify({
        ...defaults,
        enabled: true,
        baseUrl: "https://api.deepseek.com/v1",
        requestsPerMinute: 120,
        consolidation: { auto: false },
      }),
      encryptSecret("synthetic-auto-off"),
    ],
  );
  async function sourceIn(text: string) {
    const id = randomUUID(),
      key = autoOffWs + "/" + hash(text) + ".txt.gz";
    await putSource(key, text);
    await tx(owner, autoOffWs, (c) =>
      c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'test','conversation','synthetic',$3,$3,$4,1,$1::text,true)",
        [id, autoOffWs, hash(text), key],
      ),
    );
    return id;
  }
  const autoOffTopic = "consolidation-engine-auto-off-topic";
  const textA = "자동 통합 끔 A",
    textB = "자동 통합 끔 B";
  const srcA = await sourceIn(textA),
    srcB = await sourceIn(textB);
  const autoOffChange = (clientRef: string, text: string, sourceId: string) => ({
    topic: { key: autoOffTopic, title: "자동 통합 끔 검증" },
    clientRef,
    title: text,
    content: text,
    kind: "memory",
    claims: [
      {
        anchor: "decision",
        text,
        type: "user_decision",
        subject: "auto-off-subject",
        scope: "production",
        state: "current",
        evidence: [{ sourceId, revision: 1, lines: [1, 1], quote: text }],
      },
    ],
    claimRelations: [] as any[],
  });
  await tx(owner, autoOffWs, (c) =>
    publish(
      c,
      autoOffWs,
      {
        idempotencyKey: randomUUID(),
        producer: { type: "agent", client: "synthetic" },
        changes: [autoOffChange("a", textA, srcA)],
      },
      { userId: owner, scope: "manage" },
    ),
  );
  await tx(owner, autoOffWs, (c) =>
    publish(
      c,
      autoOffWs,
      {
        idempotencyKey: randomUUID(),
        producer: { type: "agent", client: "synthetic" },
        changes: [autoOffChange("b", textB, srcB)],
      },
      { userId: owner, scope: "manage" },
    ),
  );
  await tx(owner, autoOffWs, (c) =>
    scheduleConsolidation(c, autoOffWs, autoOffTopic, "cycle"),
  );
  const noModel = async () => {
    throw new Error("must not be called: consolidation.auto is false");
  };
  const signal = new AbortController().signal;
  for (let i = 0; i < 5; i++)
    assert.equal(
      await runConsolidation(owner, signal, noModel),
      false,
      "an automatic Job is created but never admitted while consolidation.auto is false",
    );
  const created = (
    await admin.query(
      "SELECT status,steps,trigger FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2",
      [autoOffWs, autoOffTopic],
    )
  ).rows[0];
  assert.equal(created.status, "pending");
  assert.equal(created.trigger, "cycle");
  assert.deepEqual(
    created.steps,
    {},
    "the Job was created (visible in the UI) but never picked up",
  );
  // A manual trigger on the same topic ignores consolidation.auto, same as it
  // already ignores the enabled/pause flag.
  await tx(owner, autoOffWs, (c) =>
    scheduleConsolidation(c, autoOffWs, autoOffTopic, "manual"),
  );
  let modelCalls = 0;
  const model = async (_config: any, _secret: any, messages: any[]) => {
    modelCalls++;
    const input = JSON.parse(messages[1].content);
    const group = input.groups[0];
    const from = group.claims.find((c: any) => c.text === textB);
    const target = group.claims.find((c: any) => c.text === textA);
    return {
      output: {
        relations: [
          {
            subject: "auto-off-subject",
            scope: "production",
            from: { articleId: from.articleId, revision: from.revision, anchor: from.anchor },
            relation: "supersedes",
            target: { articleId: target.articleId, revision: target.revision, anchor: target.anchor },
            evidence: [{ recordId: from.evidence[0].recordId }],
          },
        ],
        leaveUnresolved: [],
      },
      usage: { total_tokens: 1 },
    };
  };
  await drive(owner, autoOffWs, autoOffTopic, signal, model);
  assert.equal(modelCalls, 1, "a manual Job runs despite consolidation.auto=false");
  const finished = (
    await admin.query(
      "SELECT status,trigger FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2",
      [autoOffWs, autoOffTopic],
    )
  ).rows[0];
  assert.equal(finished.status, "completed");
  assert.equal(finished.trigger, "manual");
});

// Admission has to be part of the pick, not a test applied after it. The query
// took the oldest pending row and returned null for the whole lane if that row
// was inadmissible, so one older cycle Job hid every manual Job behind it and
// `consolidate --all` never started while consolidation.auto was false. Found
// in production: six cycle Jobs sat ahead of the manual one.
test("an older inadmissible automatic Job does not hide a manual Job", async () => {
  const blockedWs = randomUUID();
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)",
    [blockedWs, owner, "Manual behind automatic"],
  );
  await admin.query(
    "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
    [
      blockedWs,
      JSON.stringify({
        ...defaults,
        enabled: true,
        baseUrl: "https://api.deepseek.com/v1",
        requestsPerMinute: 120,
        consolidation: { auto: false },
      }),
      encryptSecret("synthetic-blocked"),
    ],
  );
  await tx(owner, blockedWs, (c) =>
    scheduleConsolidation(c, blockedWs, "older-automatic-topic", "cycle"),
  );
  await admin.query(
    "UPDATE consolidation_jobs SET created_at=now()-interval '1 hour' WHERE workspace_id=$1",
    [blockedWs],
  );
  await tx(owner, blockedWs, (c) =>
    scheduleConsolidation(c, blockedWs, "manual-topic", "manual"),
  );
  const noModel = async () => {
    throw new Error("must not be called: nothing to consolidate");
  };
  const signal = new AbortController().signal;
  assert.equal(
    await runConsolidation(owner, signal, noModel),
    true,
    "the manual Job is admitted despite an older automatic Job ahead of it",
  );
  const rows = (
    await admin.query(
      "SELECT topic_key,status FROM consolidation_jobs WHERE workspace_id=$1 ORDER BY topic_key",
      [blockedWs],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r: any) => [r.topic_key, r.status]),
    [
      ["manual-topic", "completed"],
      ["older-automatic-topic", "pending"],
    ],
    "the manual Job ran to completion; the automatic one stayed unadmitted",
  );
});

// A rerun triggered by new claims kept the same attempt, so publish rebuilt the
// finished run's idempotency key and died on the publications unique index —
// the Job then sat pending, retrying every minute, with the pg error recorded
// as the useless code "error". Two production Jobs were stuck this way.
test("a rerun with new claims publishes under a new key instead of colliding", async () => {
  const rerunWs = randomUUID();
  await admin.query("INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)", [
    rerunWs,
    owner,
    "Rerun key",
  ]);
  const jobId = randomUUID();
  await admin.query(
    `INSERT INTO consolidation_jobs(workspace_id,id,topic_key,status,trigger,attempt,steps)
     VALUES($1,$2,'rerun-topic','completed','manual',0,$3)`,
    [
      rerunWs,
      jobId,
      JSON.stringify({ gather: { status: "done", attempts: 1, input_hash: "hash-one" } }),
    ],
  );
  const keyFor = (hash: string) => "consolidation-" + jobId + "-0-" + hash;
  await admin.query(
    `INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason)
     VALUES($1,$2,$3,'h','{"type":"agent","client":"consolidation-worker"}','통합')`,
    [randomUUID(), rerunWs, keyFor("hash-one")],
  );
  // The same gather input must not publish twice...
  await assert.rejects(
    admin.query(
      `INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason)
       VALUES($1,$2,$3,'h','{"type":"agent","client":"consolidation-worker"}','통합')`,
      [randomUUID(), rerunWs, keyFor("hash-one")],
    ),
    /duplicate key/,
    "an identical gather stays idempotent",
  );
  // ...but a rerun that gathered different claims must be free to publish.
  await admin.query(
    `INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason)
     VALUES($1,$2,$3,'h','{"type":"agent","client":"consolidation-worker"}','통합')`,
    [randomUUID(), rerunWs, keyFor("hash-two")],
  );
  const keys = (
    await admin.query(
      "SELECT count(*)::int n FROM publications WHERE workspace_id=$1 AND idempotency_key LIKE $2",
      [rerunWs, "consolidation-" + jobId + "%"],
    )
  ).rows[0].n;
  assert.equal(keys, 2, "the rerun published under its own key");
});

// Only the classified output errors were capped. An unclassified failure fell
// through to the transient branch and retried forever: a production Job reached
// 51 model attempts, spending a call each time, with the cause recorded only as
// the generic CONSOLIDATION_MODEL_FAILED.
test("an unclassified model failure stops at the attempt ceiling instead of retrying forever", async () => {
  const capWs = randomUUID();
  await admin.query("INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)", [
    capWs,
    owner,
    "Model attempt cap",
  ]);
  await admin.query(
    "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
    [
      capWs,
      JSON.stringify({
        ...defaults,
        enabled: true,
        baseUrl: "https://api.deepseek.com/v1",
        requestsPerMinute: 120,
        retryDelaySeconds: 5,
      }),
      encryptSecret("synthetic-cap"),
    ],
  );
  const topic = "model-cap-topic";
  await tx(owner, capWs, (c) => scheduleConsolidation(c, capWs, topic, "manual"));
  // gather finds nothing to compare, so the model Step is never reached and the
  // Job completes; seed two current claims so the model Step actually runs.
  const src = randomUUID(),
    pub = randomUUID(),
    art = randomUUID();
  const text = "모델 상한 검증 주장";
  const key = capWs + "/" + hash(text) + ".txt.gz";
  await putSource(key, text);
  await admin.query(
    `INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked)
     VALUES($1,$2,'cap','conversation','synthetic',$5,$5,$3,1,$4,true)`,
    [src, capWs, key, src, hash(text)],
  );
  await admin.query(
    `INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason)
     VALUES($1,$2,$3,'h','{"type":"agent","client":"synthetic"}','cap')`,
    [pub, capWs, pub],
  );
  await admin.query(
    "INSERT INTO articles(id,workspace_id,title,content,kind,revision,topic_key) VALUES($1,$2,'상한','본문','memory',1,$3)",
    [art, capWs, topic],
  );
  await admin.query(
    "INSERT INTO revisions(workspace_id,article_id,revision,title,content,metadata,publication_id) VALUES($1,$2,1,'상한','본문','{}',$3)",
    [capWs, art, pub],
  );
  for (const anchor of ["a", "b"]) {
    await admin.query(
      "INSERT INTO claims(workspace_id,article_id,revision,anchor,text,type,subject,scope,state) VALUES($1,$2,1,$3,$4,'user_decision','cap-subject','production','current')",
      [capWs, art, anchor, text + " " + anchor],
    );
    await admin.query(
      "INSERT INTO evidence(workspace_id,article_id,revision,anchor,source_id,source_revision,line_start,line_end,quote) VALUES($1,$2,1,$3,$4,1,1,1,$5)",
      [capWs, art, anchor, src, text],
    );
  }
  // An error the classifier does not recognise: not a ModelError, not zod.
  const broken = async () => {
    throw new TypeError("synthetic unclassified provider failure");
  };
  const signal = new AbortController().signal;
  // Start one below the ceiling: the shared rate gate makes driving twelve real
  // attempts slow, and what matters is that the twelfth stops rather than
  // deferring again.
  await runConsolidation(owner, signal, broken);
  await admin.query(
    `UPDATE consolidation_jobs
     SET steps=jsonb_set(steps,'{model,attempts}','11'::jsonb), available_at=now()
     WHERE workspace_id=$1`,
    [capWs],
  );
  for (let i = 0; i < 20; i++) {
    await admin.query(
      "UPDATE consolidation_jobs SET available_at=now() WHERE workspace_id=$1",
      [capWs],
    );
    await runConsolidation(owner, signal, broken);
    const row = (
      await admin.query(
        "SELECT status FROM consolidation_jobs WHERE workspace_id=$1",
        [capWs],
      )
    ).rows[0];
    if (row.status === "failed") break;
    await sleep(20);
  }
  const job = (
    await admin.query(
      "SELECT status,steps FROM consolidation_jobs WHERE workspace_id=$1",
      [capWs],
    )
  ).rows[0];
  assert.equal(job.status, "failed", "the Job stops instead of retrying forever");
  assert.ok(
    job.steps.model.attempts <= 12,
    "attempts stay at or under the ceiling, got " + job.steps.model.attempts,
  );
});

// The ceiling above stopped the bleeding; this pins the wound. gather leaves
// its result in steps.model.output, and the failure branches used to rebuild
// that step from a literal, dropping it. Every retry after the first then died
// inside modelPrompt() with a TypeError before any HTTP call — so the
// "three fresh responses" rule had never once produced a second response.
test("a retry after a model failure still reaches the model with the gather result", async () => {
  const ws2 = randomUUID();
  await admin.query("INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)", [
    ws2,
    owner,
    "Model retry keeps gather",
  ]);
  await admin.query(
    "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
    [
      ws2,
      JSON.stringify({
        ...defaults,
        enabled: true,
        baseUrl: "https://api.deepseek.com/v1",
        requestsPerMinute: 120,
        retryDelaySeconds: 5,
      }),
      encryptSecret("synthetic-retry"),
    ],
  );
  const topic2 = "model-retry-topic";
  await tx(owner, ws2, (c) => scheduleConsolidation(c, ws2, topic2, "manual"));
  const src2 = randomUUID(),
    pub2 = randomUUID(),
    art2 = randomUUID();
  const text2 = "재시도 검증 주장";
  const key2 = ws2 + "/" + hash(text2) + ".txt.gz";
  await putSource(key2, text2);
  await admin.query(
    `INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked)
     VALUES($1,$2,'retry','conversation','synthetic',$5,$5,$3,1,$4,true)`,
    [src2, ws2, key2, src2, hash(text2)],
  );
  await admin.query(
    `INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason)
     VALUES($1,$2,$3,'h','{"type":"agent","client":"synthetic"}','retry')`,
    [pub2, ws2, pub2],
  );
  await admin.query(
    "INSERT INTO articles(id,workspace_id,title,content,kind,revision,topic_key) VALUES($1,$2,'재시도','본문','memory',1,$3)",
    [art2, ws2, topic2],
  );
  await admin.query(
    "INSERT INTO revisions(workspace_id,article_id,revision,title,content,metadata,publication_id) VALUES($1,$2,1,'재시도','본문','{}',$3)",
    [ws2, art2, pub2],
  );
  for (const anchor of ["a", "b"]) {
    await admin.query(
      "INSERT INTO claims(workspace_id,article_id,revision,anchor,text,type,subject,scope,state) VALUES($1,$2,1,$3,$4,'user_decision','retry-subject','production','current')",
      [ws2, art2, anchor, text2 + " " + anchor],
    );
    await admin.query(
      "INSERT INTO evidence(workspace_id,article_id,revision,anchor,source_id,source_revision,line_start,line_end,quote) VALUES($1,$2,1,$3,$4,1,1,1,$5)",
      [ws2, art2, anchor, src2, text2],
    );
  }
  // A classified output error: the retry path that is supposed to ask again.
  const prompts: string[] = [];
  const failing: any = async (_c: any, _s: any, messages: any[]) => {
    prompts.push(messages[1].content);
    throw new ModelError("AI_INVALID_JSON", false);
  };
  const signal = new AbortController().signal;
  // The first tick only runs gather; the model Step follows, and the rate gate
  // (120 rpm) holds the pick for half a second after each call, so wait it out.
  for (let i = 0; i < 6 && prompts.length < 2; i++) {
    await admin.query(
      "UPDATE consolidation_jobs SET available_at=now() WHERE workspace_id=$1",
      [ws2],
    );
    await runConsolidation(owner, signal, failing);
    await sleep(600);
  }
  assert.ok(
    prompts.length >= 2,
    "the model is asked a second time, got " + prompts.length + " call(s)",
  );
  for (const p of prompts)
    assert.ok(
      JSON.parse(p).groups?.length > 0,
      "each attempt carries the gathered groups",
    );
  const job2 = (
    await admin.query(
      "SELECT steps FROM consolidation_jobs WHERE workspace_id=$1",
      [ws2],
    )
  ).rows[0];
  assert.ok(
    job2.steps.model.output?.groups?.length > 0,
    "the gather result survives a failed model attempt",
  );
});
