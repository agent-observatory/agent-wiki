import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import {
  listWikiPages,
  wikiPageDetail,
} from "../apps/agent-wiki-api/src/wiki-pages.js";
import { hash, putSource } from "../packages/core/src/storage.js";
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("cross-session claims form one versioned topic page; history and idempotency survive", async () => {
  const owner = "pages-" + randomUUID(),
    ws = randomUUID();
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)",
    [ws, owner, "Synthetic pages"],
  );
  async function add(text: string, ref: string, target?: any) {
    const source = randomUUID(),
      key = ws + "/" + hash(text) + ".txt.gz";
    await putSource(key, text);
    await tx(owner, ws, (c) =>
      c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'test','conversation',$1::text,$3,$3,$4,1,$1::text,true)",
        [source, ws, hash(text), key],
      ),
    );
    const evidence = [
      { sourceId: source, revision: 1, lines: [1, 1], quote: text },
    ];
    const input = {
      idempotencyKey: randomUUID(),
      producer: { type: "agent", client: "remote-worker" },
      changes: [
        {
          clientRef: ref,
          topic: { key: "ai-curation", title: "AI 정제 연결" },
          title: ref,
          content: text,
          kind: "memory",
          claims: [
            {
              anchor: "provider",
              text,
              type: "user_decision",
              subject: "provider",
              scope: "curation",
              evidence,
            },
          ],
          claimRelations: target
            ? [{ anchor: "provider", relation: "supersedes", target, evidence }]
            : [],
        },
      ],
    };
    const result = await tx(owner, ws, (c) =>
      publish(c, ws, input, { userId: owner, scope: "publish" }),
    );
    assert.deepEqual(
      await tx(owner, ws, (c) =>
        publish(c, ws, input, { userId: owner, scope: "publish" }),
      ),
      result,
    );
    return result.items[0];
  }
  const first = await add(
    "NVIDIA를 사용한다. 무료로 초기 정제를 검증하기 위한 결정이다.",
    "초기 연결",
  );
  const pages = await tx(owner, ws, (c) => listWikiPages(c, ws, {}));
  assert.equal(pages.items.length, 1);
  const pageId = pages.items[0].id;
  await add(
    "지연 문제 때문에 Alibaba로 변경한다. 같은 정제 작업에 적용한다.",
    "연결 변경",
    { articleId: first.id, revision: 1, anchor: "provider" },
  );
  const current = await tx(owner, ws, (c) => wikiPageDetail(c, ws, pageId));
  assert.equal(current.revision, 2);
  assert.equal(current.snapshot.claims.length, 2);
  assert.match(current.content, /현재 상태와 설명/);
  assert.match(current.content, /Decision History/);
  assert.match(current.content, /지연 문제/);
  const past = await tx(owner, ws, (c) => wikiPageDetail(c, ws, pageId, 1));
  assert.ok(!past.content.includes("Alibaba"));
  const inaccessible = await tx("other-owner", ws, (c) =>
    listWikiPages(c, ws, {}),
  );
  assert.equal(inaccessible.items.length, 0);
});
