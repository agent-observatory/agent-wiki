import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { putSource, hash } from "../packages/core/src/storage.js";
import { defaults, encryptSecret } from "../packages/core/src/ai.js";
import { runOne } from "../apps/agent-wiki-worker/src/worker.js";
const owner = "chunk-worker-" + randomUUID(),
  ws = randomUUID(),
  source = randomUUID(),
  job = randomUUID(),
  admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
before(async () => {
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)",
    [ws, owner, "Chunk test"],
  );
  const text = Array.from({ length: 600 }, (_, i) =>
      JSON.stringify({
        event: i,
        field: JSON.stringify(["payload", "role"]),
        text: i % 2 ? "user" : "assistant",
      }),
    ).join("\n"),
    contentHash = hash(text),
    key = ws + "/" + contentHash + ".txt.gz";
  await putSource(key, text);
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'test','conversation','synthetic',$3,$3,$4,600,'test',true)",
      [source, ws, contentHash, key],
    );
    await c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [job, ws, source],
    );
    await c.query(
      "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
      [
        ws,
        JSON.stringify({ ...defaults, enabled: true, maxInputTokens: 30000 }),
        encryptSecret("synthetic"),
      ],
    );
  });
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("actual Worker fits metadata-heavy inputs before invoking the provider", async () => {
  let calls = 0;
  await runOne(
    owner,
    new AbortController().signal,
    async (_config, _key, messages: any) => {
      calls++;
      assert.ok(
        Buffer.byteLength(messages[0].content + messages[1].content) + 128 <=
          30000,
      );
      const input = JSON.parse(messages[1].content);
      assert.equal(input.source.start, 1);
      assert.ok(input.source.end < 600);
      return {
        output: {
          changes: Array.from({ length: 12 }, (_, i) => ({
            topic: { key: "synthetic-topic", title: "합성 검증 주제" },
            clientRef: `item-${i}`,
            title: `Synthetic ${i}`,
            content: `Claim ${i}`,
            kind: "memory",
            claims: [
              {
                anchor: "claim",
                text: `Claim ${i}`,
                type: "unconfirmed",
                evidence: [{ recordId: input.source.records[0].recordId }],
              },
            ],
          })),
        },
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      };
    },
  );
  assert.equal(calls, 1);
  const run = await tx(
    owner,
    ws,
    async (c) =>
      (
        await c.query(
          "SELECT status,error_code,diagnostics FROM refinement_runs WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1",
          [job],
        )
      ).rows[0],
  );
  assert.equal(run.status, "completed");
  assert.equal(run.error_code, null);
  assert.ok(run.diagnostics.inputBudget.estimatedTokens <= 30000);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM articles WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0].n,
    12,
  );
});
