import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { putSource, hash } from "../packages/core/src/storage.js";
import { defaults, encryptSecret } from "../packages/core/src/ai.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import { runOne } from "../apps/agent-wiki-worker/src/worker.js";

test("a resumed chunk retrieves its own topic instead of the source beginning", async () => {
  const admin = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const owner = "chunk-context-" + randomUUID(),
    ws = randomUUID();
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  try {
    await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
    await admin.query(
      "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,'Chunk context fixture')",
      [ws, owner],
    );
    const sourceId = randomUUID(),
      job = randomUUID();
    const topics = ["apple orchard", "PostgreSQL database"];
    const text = topics.map((t) => (t + " ").repeat(150)).join("\n");
    const digest = hash(text),
      key = ws + "/" + digest + ".txt.gz";
    await putSource(key, text);
    const ids = await tx(owner, ws, async (c) => {
      await c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'fixture','document','',$3,$3,$4,2,'fixture',true)",
        [sourceId, ws, digest, key],
      );
      const ids: string[] = [];
      for (const [index, topic] of topics.entries()) {
        const result = await publish(
          c,
          ws,
          {
            idempotencyKey: randomUUID(),
            producer: { type: "agent", client: "fixture" },
            changes: [
              {
                topic: { key: "synthetic-topic", title: "합성 검증 주제" },
                clientRef: "topic",
                title: topic,
                content: topic,
                claims: [
                  {
                    anchor: "topic",
                    text: topic,
                    type: "unconfirmed",
                    state: "unconfirmed",
                    evidence: [
                      {
                        sourceId,
                        revision: 1,
                        lines: [index + 1, index + 1],
                        quote: text.split("\n")[index],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { userId: owner, scope: "session" },
        );
        ids.push(result.items[0].id);
      }
      await c.query(
        "INSERT INTO refinement_jobs(id,workspace_id,source_id,chunk_index,chunk_count,chunk_plan) VALUES($1,$2,$3,1,2,$4)",
        [
          job,
          ws,
          sourceId,
          {
            sourceHash: digest,
            chunks: [
              { start: 1, end: 1, contextStart: 1, contextEnd: 0 },
              { start: 2, end: 2, contextStart: 2, contextEnd: 1 },
            ],
          },
        ],
      );
      await c.query(
        "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
        [
          ws,
          {
            ...defaults,
            enabled: true,
            primary: { ...defaults.primary, maxInputTokens: 16000 },
          },
          encryptSecret("fixture"),
        ],
      );
      return ids;
    });
    let called = false;
    await runOne(
      owner,
      new AbortController().signal,
      async (_config, _key, messages) => {
        const input = JSON.parse((messages[1] as { content: string }).content);
        assert.equal(input.source.start, 2);
        assert.equal(input.related[0].id, ids[1]);
        called = true;
        return { output: { changes: [] }, usage: { total_tokens: 1 } };
      },
    );
    assert.equal(called, true);
    const jobState = (
      await admin.query(
        "SELECT status,error_code FROM refinement_jobs WHERE id=$1",
        [job],
      )
    ).rows[0];
    assert.equal(jobState.status, "completed", jobState.error_code);
  } finally {
    await admin.end();
    await pool.end();
  }
});
