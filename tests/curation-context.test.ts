import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, putSource } from "../packages/core/src/storage.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import {
  curationContext,
  CONTEXT_BUDGET,
} from "../apps/agent-wiki-worker/src/curation-context.js";
import { estimateTokens } from "../packages/core/src/chunking.js";
const owner = "context-" + randomUUID(),
  ws = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let incoming: string, otherIncoming: string, database: string;
async function source(text: string, origin: string) {
  const id = randomUUID(),
    digest = hash(text),
    key = ws + "/" + digest + ".txt.gz";
  await putSource(key, text);
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'synthetic','conversation',$3,$4,$4,$5,1,$6,true)",
      [id, ws, origin, digest, key, randomUUID()],
    ),
  );
  return id;
}
before(async () => {
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)",
    [ws, owner, "Synthetic context evaluation"],
  );
  incoming = await source(
    "Supabase를 취소하고 PostgreSQL을 운영 데이터베이스로 사용한다.",
    "current-session",
  );
  otherIncoming = await source("PostgreSQL 운영 데이터베이스", "new-session");
  const documents = [
    {
      title: "운영 데이터베이스",
      text: "운영 데이터베이스는 Supabase를 사용한다.",
      origin: "prior-session",
      subject: "database",
    },
    ...Array.from({ length: 6 }, (_, i) => ({
      title: "화면 디자인 " + i,
      text:
        "버튼과 메뉴의 여백은 일정하게 유지한다. " +
        "사용자 화면의 글꼴과 색상은 통일하고 간격을 맞춘다. ".repeat(2) +
        i,
      origin: "current-session",
      subject: "interface",
    })),
  ];
  for (const doc of documents) {
    const id = await source(doc.text, doc.origin);
    const result = await tx(owner, ws, (c) =>
      publish(
        c,
        ws,
        {
          idempotencyKey: randomUUID(),
          producer: { type: "agent", client: "synthetic" },
          changes: [
            {
              clientRef: "item",
              title: doc.title,
              content: doc.text,
              claims: [
                {
                  anchor: "decision",
                  text: doc.text,
                  type: "user_decision",
                  subject: doc.subject,
                  scope: "production",
                  state: "current",
                  evidence: [
                    {
                      sourceId: id,
                      revision: 1,
                      lines: [1, 1],
                      quote: doc.text,
                    },
                  ],
                },
              ],
            },
          ],
        },
        { userId: owner, scope: "session" },
      ),
    );
    if (doc.subject === "database") database = result.items[0].id;
  }
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("curation finds cross-session knowledge and abstains from ambiguous or unrelated matches", async () => {
  const cases = [
    {
      name: "explicit-cross-session-change",
      source: () => incoming,
      text: "Supabase를 취소하고 PostgreSQL을 운영 데이터베이스로 사용한다.",
      expected: "database",
    },
    {
      name: "same-session-continuation",
      source: () => incoming,
      text: "그거 취소하고 다시 검토하자.",
      expected: "none",
    },
    {
      name: "unrelated-topic",
      source: () => incoming,
      text: "보라색 고양이 사료",
      expected: "none",
    },
    {
      name: "new-session-topic",
      source: () => otherIncoming,
      text: "Supabase 운영 데이터베이스를 다시 검토한다.",
      expected: "database",
    },
  ];
  const results = [];
  for (const item of cases) {
    const { related: selected, diagnostics } = await tx(owner, ws, (c) =>
      curationContext(c, ws, item.source(), item.text),
    );
    const bytes = estimateTokens(JSON.stringify(selected));
    assert.ok(bytes <= CONTEXT_BUDGET);
    assert.ok(selected.length <= 6);
    if (item.expected === "database") {
      const structured = [
        { event: 1, field: JSON.stringify(["payload", "role"]), text: "user" },
        {
          event: 1,
          field: JSON.stringify(["payload", "message"]),
          text: item.text,
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n");
      const { related: fromRecords } = await tx(owner, ws, (c) =>
        curationContext(c, ws, item.source(), structured),
      );
      assert.ok(
        fromRecords.some((claim) => claim.id === database),
        "projected session records retain the relevant decision",
      );
    }
    results.push({
      name: item.name,
      selected: selected.length,
      sameSession: selected.filter((x) => x.same_session).length,
      databaseIncluded: selected.some((x) => x.id === database),
      inputBytes: bytes,
      passed:
        item.expected === "database"
          ? selected.some((x) => x.id === database)
          : selected.length === 0,
    });
    assert.equal(diagnostics.corpusSize, 7);
    assert.ok(
      diagnostics.candidates.every(
        (hit) => !("text" in hit) && !("matched" in hit),
      ),
    );
  }
  if (process.env.CONTEXT_REPORT)
    await writeFile(
      process.env.CONTEXT_REPORT,
      JSON.stringify(
        {
          cases: results.length,
          passed: results.filter((x) => x.passed).length,
          results,
        },
        null,
        2,
      ) + "\n",
    );
  assert.ok(
    results.every((x) => x.passed),
    JSON.stringify(results),
  );
});
