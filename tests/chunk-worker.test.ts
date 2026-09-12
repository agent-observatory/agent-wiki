import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { putSource, hash } from "../packages/core/src/storage.js";
import {
  defaults,
  encryptSecret,
  ModelError,
} from "../packages/core/src/ai.js";
import { runOne } from "../apps/worker/src/worker.js";
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
  const text = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({
        event: Math.floor(i / 10),
        role: "user",
        text: "검증용 작업 기록 " + i + " " + "문맥 ".repeat(15),
      }),
    ).join("\n"),
    contentHash = hash(text),
    key = ws + "/" + contentHash + ".txt.gz";
  await putSource(key, text);
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'test','conversation','synthetic',$3,$3,$4,100,'test',true)",
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
        JSON.stringify({ ...defaults, enabled: true }),
        encryptSecret("synthetic"),
      ],
    );
  });
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("successful chunks survive a later failure and resume at the failed chunk with exact coverage", async () => {
  const starts: number[] = [];
  const model = async (_c: any, _k: any, m: any) => {
    const input = JSON.parse(m[1].content);
    starts.push(input.source.start);
    assert.ok(
      Buffer.byteLength(m[0].content + m[1].content) <= defaults.maxInputTokens,
    );
    return { output: { changes: [] }, usage: { total_tokens: 50 } };
  };
  await runOne(owner, new AbortController().signal, model);
  await releaseGate();
  await runOne(owner, new AbortController().signal, model);
  let row = (
    await tx(owner, ws, (c) =>
      c.query("SELECT * FROM refinement_jobs WHERE id=$1", [job]),
    )
  ).rows[0];
  assert.equal(row.chunk_index, 2);
  assert.equal(row.status, "pending");
  assert.ok(row.chunk_count > 2);
  await releaseGate();
  await runOne(owner, new AbortController().signal, async () => {
    throw new ModelError("AI_INVALID_JSON");
  });
  row = (
    await tx(owner, ws, (c) =>
      c.query("SELECT * FROM refinement_jobs WHERE id=$1", [job]),
    )
  ).rows[0];
  assert.equal(row.status, "failed");
  assert.equal(row.chunk_index, 2);
  assert.equal(row.chunk_results.length, 2);
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE refinement_jobs SET status='pending',attempts=0,available_at=now() WHERE id=$1",
      [job],
    ),
  );
  await releaseGate();
  while (await runOne(owner, new AbortController().signal, model)) {
    await releaseGate();
  }
  row = (
    await tx(owner, ws, (c) =>
      c.query("SELECT * FROM refinement_jobs WHERE id=$1", [job]),
    )
  ).rows[0];
  assert.equal(row.status, "completed");
  assert.equal(row.chunk_index, row.chunk_count);
  assert.equal(new Set(starts).size, starts.length);
  assert.equal(starts.length, row.chunk_count);
});

async function releaseGate() {
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
}
