import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, putSource } from "../packages/core/src/storage.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
// A relation-only publish failure (the target moved or was already retired)
// must not discard the whole extraction: the claim still publishes and only
// the failed relation waits in consolidation_inbox for the topic's next
// Consolidation Job. docs/l2-l3-memory.md#관계-지연--대기함.
const owner = "consolidation-inbox-" + randomUUID(),
  ws = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,'Consolidation inbox')",
    [ws, owner],
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
function change(
  clientRef: string,
  text: string,
  sourceId: string,
  claimRelations: any[] = [],
) {
  return {
    topic: { key: "db-choice", title: "DB 선택" },
    clientRef,
    title: text,
    content: text,
    kind: "memory",
    claims: [
      {
        anchor: "decision",
        text,
        type: "user_decision",
        subject: "database",
        scope: "production",
        state: "current",
        evidence: [{ sourceId, revision: 1, lines: [1, 1], quote: text }],
      },
    ],
    claimRelations,
  };
}
function automatic(changes: any[]) {
  return {
    idempotencyKey: randomUUID(),
    producer: { type: "agent" as const, client: "remote-worker" },
    changes,
  };
}
test("a relation targeting an already-retired claim is deferred, not discarded, on an automatic publish", async () => {
  const textA = "운영 DB는 MySQL을 사용한다.",
    textB = "운영 DB는 PostgreSQL로 바꾼다.",
    textC = "운영 DB는 여전히 MySQL이라고 착각한 뒤늦은 기록.";
  const srcA = await source(textA),
    srcB = await source(textB),
    srcC = await source(textC);
  const a = await tx(owner, ws, (c) =>
    publish(c, ws, automatic([change("a", textA, srcA)]), {
      userId: owner,
      scope: "publish",
    }),
  );
  const b = await tx(owner, ws, (c) =>
    publish(
      c,
      ws,
      automatic([
        change("b", textB, srcB, [
          {
            anchor: "decision",
            relation: "supersedes",
            target: { articleId: a.items[0].id, revision: 1, anchor: "decision" },
            evidence: [{ sourceId: srcB, revision: 1, lines: [1, 1], quote: textB }],
          },
        ]),
      ]),
      { userId: owner, scope: "publish" },
    ),
  );
  assert.equal(b.items.length, 1);
  // C also targets A's revision 1, which is already retired by B by now.
  const result = await tx(owner, ws, (c) =>
    publish(
      c,
      ws,
      automatic([
        change("c", textC, srcC, [
          {
            anchor: "decision",
            relation: "supersedes",
            target: { articleId: a.items[0].id, revision: 1, anchor: "decision" },
            evidence: [{ sourceId: srcC, revision: 1, lines: [1, 1], quote: textC }],
          },
        ]),
      ]),
      { userId: owner, scope: "publish" },
    ),
  );
  assert.equal((result as any).deferredRelations, 1);
  assert.equal(result.items.length, 1, "the claim still publishes");
  const cArticleId = result.items[0].id;
  const claim = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT state FROM claims WHERE workspace_id=$1 AND article_id=$2 AND revision=1 AND anchor='decision'",
        [ws, cArticleId],
      ),
    )
  ).rows[0];
  assert.equal(claim.state, "current");
  const relation = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT 1 FROM claim_relations WHERE workspace_id=$1 AND from_article_id=$2",
        [ws, cArticleId],
      ),
    )
  ).rows[0];
  assert.equal(relation, undefined, "the failed relation is not stored");
  const inbox = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM consolidation_inbox WHERE workspace_id=$1 AND from_article_id=$2",
        [ws, cArticleId],
      ),
    )
  ).rows[0];
  assert.equal(inbox.to_article_id, a.items[0].id);
  assert.equal(inbox.relation, "supersedes");
  assert.equal(inbox.error_code, "CLAIM_TARGET_ALREADY_RETIRED");
  assert.equal(inbox.status, "pending");
  const job = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM consolidation_jobs WHERE workspace_id=$1 AND topic_key='db-choice'",
        [ws],
      ),
    )
  ).rows[0];
  assert.equal(job.status, "pending");
  assert.equal(job.trigger, "deferred");
});
test("a manual (non-automatic) publish still throws immediately instead of deferring", async () => {
  const textA = "테스트 결정 A.",
    textB = "테스트 결정 B — A를 대체.",
    textC = "이미 대체된 A를 다시 겨냥.";
  const srcA = await source(textA),
    srcB = await source(textB),
    srcC = await source(textC);
  const manual = (changes: any[]) => ({
    idempotencyKey: randomUUID(),
    producer: { type: "agent" as const, client: "synthetic" },
    changes,
  });
  const a = await tx(owner, ws, (c) =>
    publish(c, ws, manual([change("a2", textA, srcA)]), {
      userId: owner,
      scope: "manage",
    }),
  );
  await tx(owner, ws, (c) =>
    publish(
      c,
      ws,
      manual([
        change("b2", textB, srcB, [
          {
            anchor: "decision",
            relation: "supersedes",
            target: { articleId: a.items[0].id, revision: 1, anchor: "decision" },
            evidence: [{ sourceId: srcB, revision: 1, lines: [1, 1], quote: textB }],
          },
        ]),
      ]),
      { userId: owner, scope: "manage" },
    ),
  );
  await assert.rejects(
    tx(owner, ws, (c) =>
      publish(
        c,
        ws,
        manual([
          change("c2", textC, srcC, [
            {
              anchor: "decision",
              relation: "supersedes",
              target: {
                articleId: a.items[0].id,
                revision: 1,
                anchor: "decision",
              },
              evidence: [
                { sourceId: srcC, revision: 1, lines: [1, 1], quote: textC },
              ],
            },
          ]),
        ]),
        { userId: owner, scope: "manage" },
      ),
    ),
    (e: any) => e.code === "CLAIM_TARGET_ALREADY_RETIRED",
  );
});
