import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { refinementHealth } from "../apps/api/src/refinement-health.js";
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
after(async () => {
  await pool.end();
  await admin.end();
});

test("health compares measured attempts, excludes legacy and preflight failures, and isolates workspaces", async () => {
  const owner = randomUUID(),
    ws = randomUUID(),
    other = randomUUID(),
    source = randomUUID(),
    job = randomUUID();
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,'health'),($3,$2,'other')",
    [ws, owner, other],
  );
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'health','text','','hash','hash','unused',1,'health',true)",
      [source, ws],
    );
    await c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [job, ws, source],
    );
    const d = {
      version: 1,
      requestedAt: new Date().toISOString(),
      durationMs: 1000,
      httpRequests: 1,
      attempt: 1,
    };
    for (const [status, error, diag] of [
      ["completed", null, { ...d, stage: "completed" }],
      [
        "failed",
        "AI_HTTP_429",
        {
          ...d,
          stage: "model",
          attempt: 2,
          httpStatus: 429,
          retryDelaySeconds: 120,
        },
      ],
      ["running", null, { ...d, durationMs: undefined }],
      ["failed", "AI_LINE_TOO_LARGE", { version: 1, stage: "prepare" }],
      ["completed", null, {}],
    ])
      await c.query(
        "INSERT INTO refinement_runs(id,workspace_id,job_id,settings,prompt_version,status,error_code,diagnostics) VALUES($1,$2,$3,$4,'test',$5,$6,$7)",
        [
          randomUUID(),
          ws,
          job,
          { provider: "nvidia", model: "synthetic-flash" },
          status,
          error,
          diag,
        ],
      );
    const health = await refinementHealth(c, ws);
    assert.equal(health.models[0].attempts, 3);
    assert.equal(health.models[0].completed, 1);
    assert.equal(health.models[0].failed, 1);
    assert.equal(health.models[0].running, 1);
    assert.equal(health.models[0].retries, 1);
    assert.equal(health.models[0].unmeasured, 1);
    assert.equal(health.models[0].average_ms, 1000);
    assert.equal(health.errors.length, 2);
    assert.equal(health.daily[0].attempts, 3);
    assert.deepEqual((await refinementHealth(c, other)).models, []);
    assert.ok(!JSON.stringify(health).includes("input"));
  });
  assert.deepEqual(await tx(owner, other, (c) => refinementHealth(c, ws)), {
    days: 7,
    models: [],
    errors: [],
    daily: [],
  });
});
