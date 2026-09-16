import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { putSource, hash } from "../packages/core/src/storage.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import {
  triggerConsolidation,
  consolidationStatus,
} from "../apps/agent-wiki-api/src/consolidation-control.js";
import { scheduleConsolidation } from "../packages/core/src/consolidation.js";
// Manual trigger and status for `agent-wiki consolidate`
// (docs/l2-l3-memory.md#언제-실행하나): a topic must exist, a repeat trigger
// while a Job is already open flags rerun_requested instead of a second Job.
const owner = "consolidation-control-" + randomUUID(),
  ws = randomUUID(),
  topicKey = "consolidation-control-topic",
  admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
before(async () => {
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)",
    [ws, owner, "Consolidation control test"],
  );
  const text = "제어 명령 검증용 주장이다.",
    key = ws + "/" + hash(text) + ".txt.gz";
  await putSource(key, text);
  const sourceId = randomUUID();
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'test','conversation','synthetic',$3,$3,$4,1,$1::text,true)",
      [sourceId, ws, hash(text), key],
    ),
  );
  await tx(owner, ws, (c) =>
    publish(
      c,
      ws,
      {
        idempotencyKey: randomUUID(),
        producer: { type: "agent", client: "synthetic" },
        changes: [
          {
            topic: { key: topicKey, title: "제어 명령 검증" },
            clientRef: "a",
            title: text,
            content: text,
            kind: "memory",
            claims: [
              {
                anchor: "decision",
                text,
                type: "user_decision",
                subject: "control",
                scope: "experiment",
                state: "current",
                evidence: [{ sourceId, revision: 1, lines: [1, 1], quote: text }],
              },
            ],
            claimRelations: [],
          },
        ],
      },
      { userId: owner, scope: "manage" },
    ),
  );
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("triggering a nonexistent topic fails clearly", async () => {
  await assert.rejects(
    tx(owner, ws, (c) => triggerConsolidation(c, ws, "no-such-topic")),
    (e: any) => e.code === "TOPIC_NOT_FOUND",
  );
});
test("triggering an existing topic creates a manual Job, and status reports it", async () => {
  const result = await tx(owner, ws, (c) => triggerConsolidation(c, ws, topicKey));
  assert.equal(result.ok, true);
  const byTopic = await tx(owner, ws, (c) => consolidationStatus(c, ws, topicKey));
  assert.equal(byTopic.job.topic_key, topicKey);
  assert.equal(byTopic.job.trigger, "manual");
  assert.equal(byTopic.job.status, "pending");
  const all = (await tx(owner, ws, (c) => consolidationStatus(c, ws))) as { items: any[] };
  assert.ok(all.items.some((j: any) => j.topic_key === topicKey));
});
test("a repeat trigger while a Job is open sets rerun_requested instead of creating a second Job", async () => {
  const otherTopic = "consolidation-control-rerun-topic";
  const src = await (async () => {
    const text = "재실행 검증용 주장이다.",
      key = ws + "/" + hash(text) + ".txt.gz",
      id = randomUUID();
    await putSource(key, text);
    await tx(owner, ws, (c) =>
      c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'test','conversation','synthetic',$3,$3,$4,1,$1::text,true)",
        [id, ws, hash(text), key],
      ),
    );
    return { id, text };
  })();
  await tx(owner, ws, (c) =>
    publish(
      c,
      ws,
      {
        idempotencyKey: randomUUID(),
        producer: { type: "agent", client: "synthetic" },
        changes: [
          {
            topic: { key: otherTopic, title: "재실행 검증" },
            clientRef: "a",
            title: src.text,
            content: src.text,
            kind: "memory",
            claims: [
              {
                anchor: "decision",
                text: src.text,
                type: "user_decision",
                subject: "rerun",
                scope: "experiment",
                state: "current",
                evidence: [{ sourceId: src.id, revision: 1, lines: [1, 1], quote: src.text }],
              },
            ],
            claimRelations: [],
          },
        ],
      },
      { userId: owner, scope: "manage" },
    ),
  );
  await tx(owner, ws, (c) => scheduleConsolidation(c, ws, otherTopic, "manual"));
  await tx(owner, ws, (c) =>
    c.query("UPDATE consolidation_jobs SET status='running' WHERE workspace_id=$1 AND topic_key=$2", [ws, otherTopic]),
  );
  await tx(owner, ws, (c) => triggerConsolidation(c, ws, otherTopic));
  const rows = (
    await tx(owner, ws, (c) =>
      c.query("SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2", [ws, otherTopic]),
    )
  ).rows;
  assert.equal(rows.length, 1, "no second Job row was created");
  assert.equal(rows[0].rerun_requested, true);
});
