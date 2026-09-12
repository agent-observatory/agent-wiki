import pg from "pg";
import { randomUUID } from "node:crypto";
import { pool, tx } from "../../packages/core/src/db.js";
import { refinementProgress } from "../../apps/agent-wiki-api/src/refinement-progress.js";
import { nextCurationJob } from "../../packages/core/src/curation-queue.js";
for (const name of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
  const value = process.env[name];
  if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname))
    throw new Error("Benchmark requires a local PostgreSQL database: " + name);
}
const db = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  }),
  owner = "benchmark-" + randomUUID(),
  ws = randomUUID();
try {
  await db.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await db.query("INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$2)", [
    ws,
    owner,
  ]);
  for (const count of [1000, 10000]) {
    await db.query(
      `INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked,created_at) SELECT gen_random_uuid(),$1,'Synthetic','conversation','codex:benchmark','synthetic','synthetic','unused',1,'benchmark-'||g,true,'2026-01-01'::timestamptz+g*interval '1 second' FROM generate_series(1,$2) g ON CONFLICT(workspace_id,idempotency_key) DO NOTHING`,
      [ws, count],
    );
    await db.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) SELECT gen_random_uuid(),workspace_id,id FROM sources WHERE workspace_id=$1 ON CONFLICT(workspace_id,source_id) DO NOTHING",
      [ws],
    );
    const start = performance.now();
    let result = await tx(owner, ws, (c) => refinementProgress(c, ws, 0));
    const summaryMs = performance.now() - start;
    const dequeue = performance.now();
    await tx(owner, ws, (c) => nextCurationJob(c, ws));
    console.log(
      JSON.stringify({
        jobs: count,
        eligible: result.summary.eligible,
        summaryMs: Math.round(summaryMs),
        dequeueMs: Math.round(performance.now() - dequeue),
      }),
    );
  }
} finally {
  await db.query("DELETE FROM refinement_jobs WHERE workspace_id=$1", [ws]);
  await db.query("DELETE FROM sources WHERE workspace_id=$1", [ws]);
  await db.query("DELETE FROM workspaces WHERE id=$1", [ws]);
  await db.query("DELETE FROM users WHERE id=$1", [owner]);
  await db.end();
  await pool.end();
}
