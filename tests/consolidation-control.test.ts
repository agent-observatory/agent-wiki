import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { putSource, hash } from "../packages/core/src/storage.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import {
  triggerConsolidation,
  triggerAllConsolidations,
  consolidationStatus,
  consolidationPlan,
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
test("a manual trigger takes over a pending cycle Job in place, without creating a second row", async () => {
  const cycleTopic = "consolidation-control-cycle-takeover";
  const text = "자동 주기 트리거 검증용 주장이다.",
    key = ws + "/" + hash(text) + ".txt.gz",
    sourceId = randomUUID();
  await putSource(key, text);
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
            topic: { key: cycleTopic, title: "자동 주기 검증" },
            clientRef: "a",
            title: text,
            content: text,
            kind: "memory",
            claims: [
              {
                anchor: "decision",
                text,
                type: "user_decision",
                subject: "cycle-takeover",
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
  await tx(owner, ws, (c) => scheduleConsolidation(c, ws, cycleTopic, "cycle"));
  const before = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2",
        [ws, cycleTopic],
      ),
    )
  ).rows[0];
  assert.equal(before.status, "pending");
  assert.equal(before.trigger, "cycle");
  assert.equal(before.rerun_requested, false);
  await tx(owner, ws, (c) => triggerConsolidation(c, ws, cycleTopic));
  const rows = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=$2",
        [ws, cycleTopic],
      ),
    )
  ).rows;
  assert.equal(rows.length, 1, "no second Job row was created");
  const after = rows[0];
  assert.equal(after.id, before.id, "the same Job row is taken over, not replaced");
  assert.equal(after.trigger, "manual");
  assert.equal(after.rerun_requested, false, "a takeover does not also flag a rerun");
  assert.ok(new Date(after.available_at).getTime() <= Date.now());
});
test("{all:true} schedules only topics with an eligible group; plan is a read-only dry run of the same eligibility", async () => {
  const eligibleTopic = "consolidation-control-all-eligible",
    idleTopic = "consolidation-control-all-idle";
  async function makeSource(text: string) {
    const id = randomUUID(),
      sourceKey = ws + "/" + hash(text) + ".txt.gz";
    await putSource(sourceKey, text);
    await tx(owner, ws, (c) =>
      c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'test','conversation','synthetic',$3,$3,$4,1,$1::text,true)",
        [id, ws, hash(text), sourceKey],
      ),
    );
    return id;
  }
  async function publishClaim(
    topicKeyValue: string,
    clientRef: string,
    text: string,
    sourceId: string,
    subject: string,
  ) {
    return tx(owner, ws, (c) =>
      publish(
        c,
        ws,
        {
          idempotencyKey: randomUUID(),
          producer: { type: "agent", client: "synthetic" },
          changes: [
            {
              topic: { key: topicKeyValue, title: "전체 통합 검증" },
              clientRef,
              title: text,
              content: text,
              kind: "memory",
              claims: [
                {
                  anchor: "decision",
                  text,
                  type: "user_decision",
                  subject,
                  scope: "experiment",
                  state: "current",
                  evidence: [
                    { sourceId, revision: 1, lines: [1, 1], quote: text },
                  ],
                },
              ],
              claimRelations: [],
            },
          ],
        },
        { userId: owner, scope: "manage" },
      ),
    );
  }
  const textA = "전체 통합 대상 A",
    textB = "전체 통합 대상 B (충돌)",
    idleText = "전체 통합에서 건너뛸 단일 주장";
  await publishClaim(eligibleTopic, "a", textA, await makeSource(textA), "all-subject");
  await publishClaim(eligibleTopic, "b", textB, await makeSource(textB), "all-subject");
  await publishClaim(idleTopic, "solo", idleText, await makeSource(idleText), "idle-subject");
  const plan = (await tx(owner, ws, (c) => consolidationPlan(c, ws))) as {
    topics: { topicKey: string }[];
  };
  const planned = plan.topics.map((t) => t.topicKey);
  assert.ok(planned.includes(eligibleTopic));
  assert.ok(
    !planned.includes(idleTopic),
    "a topic with nothing to consolidate is not planned",
  );
  const eligiblePlan = (await tx(owner, ws, (c) =>
    consolidationPlan(c, ws, eligibleTopic),
  )) as { groups: any[] };
  assert.equal(eligiblePlan.groups.length, 1);
  assert.equal(eligiblePlan.groups[0].claims.length, 2);
  assert.ok(
    eligiblePlan.groups[0].claims.every(
      (c: any) => c.type === "user_decision" && c.state === "current",
    ),
  );
  const idlePlan = (await tx(owner, ws, (c) =>
    consolidationPlan(c, ws, idleTopic),
  )) as { groups: any[] };
  assert.equal(idlePlan.groups.length, 0);
  const result = await tx(owner, ws, (c) => triggerAllConsolidations(c, ws));
  assert.ok(result.scheduled.includes(eligibleTopic));
  assert.ok(!result.scheduled.includes(idleTopic));
  const jobs = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT topic_key,trigger,status FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key=ANY($2::text[])",
        [ws, [eligibleTopic, idleTopic]],
      ),
    )
  ).rows;
  assert.deepEqual(jobs, [
    { topic_key: eligibleTopic, trigger: "manual", status: "pending" },
  ]);
});
