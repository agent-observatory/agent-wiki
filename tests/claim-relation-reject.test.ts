import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, putSource } from "../packages/core/src/storage.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import { rejectClaimRelation } from "../apps/agent-wiki-api/src/claim-relation-reject.js";
// relation reject reverses an auto-applied relation by publishing a
// corrective Version, never by deleting the relation row or the earlier
// Version. docs/l2-l3-memory.md#relation-reject--자동-반영을-되돌리는-명령.
const owner = "relation-reject-" + randomUUID(),
  ws = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,'Relation reject')",
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
function change(clientRef: string, text: string, sourceId: string) {
  return {
    topic: { key: "relation-reject-topic", title: "관계 거부 검증" },
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
test("rejecting a supersedes relation restores the target's effective state via a corrective Version", async () => {
  const textA = "캐시는 Redis를 사용한다.",
    textB = "캐시는 Memcached로 바꾼다.";
  const srcA = await source(textA),
    srcB = await source(textB);
  const a = await publishManual({
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [change("a", textA, srcA)],
  });
  const b = await publishManual({
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [
      {
        ...change("b", textB, srcB),
        claimRelations: [
          {
            anchor: "decision",
            relation: "supersedes",
            target: {
              articleId: a.items[0].id,
              revision: 1,
              anchor: "decision",
            },
            evidence: [
              { sourceId: srcB, revision: 1, lines: [1, 1], quote: textB },
            ],
          },
        ],
      },
    ],
  });
  const before = (
    await tx(owner, ws, (c) =>
      c.query(
        `SELECT CASE WHEN EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=$1 AND cr.to_article_id=$2 AND cr.to_revision=1 AND cr.to_anchor='decision' AND cr.relation='supersedes') THEN 'superseded' ELSE 'current' END AS state`,
        [ws, a.items[0].id],
      ),
    )
  ).rows[0];
  assert.equal(before.state, "superseded");
  const rejected = await tx(owner, ws, (c) =>
    rejectClaimRelation(
      c,
      ws,
      {
        from: { articleId: b.items[0].id, revision: 1, anchor: "decision" },
        to: { articleId: a.items[0].id, revision: 1, anchor: "decision" },
        relation: "supersedes",
        client: "claude",
        reason: "테스트: 통합이 잘못 관계를 만들었다",
      },
      { userId: owner },
    ),
  );
  assert.equal(rejected.ok, true);
  assert.ok(rejected.publicationId);
  const article = (
    await tx(owner, ws, (c) =>
      c.query("SELECT revision FROM articles WHERE workspace_id=$1 AND id=$2", [
        ws,
        a.items[0].id,
      ]),
    )
  ).rows[0];
  assert.equal(article.revision, 2, "a corrective Version 2 was published");
  const newClaimState = (
    await tx(owner, ws, (c) =>
      c.query(
        `SELECT CASE WHEN EXISTS(SELECT 1 FROM claim_relations cr WHERE cr.workspace_id=$1 AND cr.to_article_id=$2 AND cr.to_revision=2 AND cr.to_anchor='decision' AND cr.relation='supersedes') THEN 'superseded' ELSE 'current' END AS state`,
        [ws, a.items[0].id],
      ),
    )
  ).rows[0];
  assert.equal(newClaimState.state, "current", "revision 2 reads as current");
  const rejection = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM claim_relation_rejections WHERE workspace_id=$1 AND from_article_id=$2",
        [ws, b.items[0].id],
      ),
    )
  ).rows[0];
  assert.equal(rejection.to_article_id, a.items[0].id);
  assert.equal(rejection.relation, "supersedes");
  // The original relation on revision 1 is preserved, not deleted.
  const originalRelation = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT 1 FROM claim_relations WHERE workspace_id=$1 AND from_article_id=$2 AND to_revision=1",
        [ws, b.items[0].id],
      ),
    )
  ).rows[0];
  assert.ok(originalRelation, "history is preserved, nothing was deleted");
  await assert.rejects(
    tx(owner, ws, (c) =>
      rejectClaimRelation(
        c,
        ws,
        {
          from: { articleId: b.items[0].id, revision: 1, anchor: "decision" },
          to: { articleId: a.items[0].id, revision: 1, anchor: "decision" },
          relation: "supersedes",
          client: "claude",
          reason: "다시 거부 시도",
        },
        { userId: owner },
      ),
    ),
    (e: any) => e.code === "CLAIM_RELATION_ALREADY_REJECTED",
  );
});
test("rejecting a relation that does not exist fails clearly", async () => {
  await assert.rejects(
    tx(owner, ws, (c) =>
      rejectClaimRelation(
        c,
        ws,
        {
          from: { articleId: randomUUID(), revision: 1, anchor: "decision" },
          to: { articleId: randomUUID(), revision: 1, anchor: "decision" },
          relation: "supersedes",
          client: "claude",
          reason: "no such relation",
        },
        { userId: owner },
      ),
    ),
    (e: any) => e.code === "CLAIM_RELATION_NOT_FOUND",
  );
});
