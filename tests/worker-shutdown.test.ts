import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { hash, putSource } from "../packages/core/src/storage.js";
import { defaults, encryptSecret } from "../packages/core/src/ai.js";
test("real Worker SIGTERM finishes current model result before leaving the job completed", async () => {
  const admin = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const owner = "shutdown-" + randomUUID(),
    ws = randomUUID(),
    source = randomUUID(),
    job = randomUUID(),
    text = '{"message":"synthetic"}',
    encryption = randomBytes(32).toString("hex");
  process.env.AI_ENCRYPTION_KEY = encryption;
  try {
    await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
    await admin.query(
      "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$2)",
      [ws, owner],
    );
    await putSource(ws + "/" + hash(text) + ".txt.gz", text);
    await admin.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'shutdown','conversation','synthetic',$3,$3,$4,1,$5,false)",
      [source, ws, hash(text), ws + "/" + hash(text) + ".txt.gz", source],
    );
    await admin.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [job, ws, source],
    );
    await admin.query(
      "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
      [
        ws,
        JSON.stringify({ ...defaults, enabled: true }),
        encryptSecret("synthetic-key"),
      ],
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {workerMain} from './apps/agent-wiki-worker/src/worker.ts';await workerMain(async()=>{console.log('CALL_STARTED');await new Promise(r=>setTimeout(r,800));return {output:{changes:[]},usage:{total_tokens:1}}});`,
      ],
      {
        env: {
          ...process.env,
          OWNER_GITHUB_ID: owner,
          AI_ENCRYPTION_KEY: encryption,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let signaled = false;
    child.stdout.on("data", (d) => {
      if (!signaled && String(d).includes("CALL_STARTED")) {
        signaled = true;
        child.kill("SIGTERM");
      }
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    const code = await new Promise((r) => child.on("exit", r));
    clearTimeout(timer);
    assert.equal(code, 0);
    assert.ok(signaled);
    assert.equal(
      (
        await admin.query("SELECT status FROM refinement_jobs WHERE id=$1", [
          job,
        ])
      ).rows[0].status,
      "completed",
    );
  } finally {
    await admin.end();
  }
});
