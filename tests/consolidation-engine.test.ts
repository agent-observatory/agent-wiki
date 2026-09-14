import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { putSource, hash } from "../packages/core/src/storage.js";
import { defaults, encryptSecret } from "../packages/core/src/ai.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import { runConsolidation } from "../apps/agent-wiki-worker/src/consolidate.js";
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
      JSON.stringify({ ...defaults, enabled: true, baseUrl: "https://api.deepseek.com/v1" }),
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
  let iterations = 0;
  while ((await runConsolidation(owner, signal, model)) && iterations < 10) iterations++;
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
            scope: "solo-scope",
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
  let iterations = 0;
  while ((await runConsolidation(owner, signal, model as any)) && iterations < 10) iterations++;
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
