import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { nextCurationJob } from "../packages/core/src/curation-queue.js";
import { refinementProgress } from "../apps/agent-wiki-api/src/refinement-progress.js";
import { retryRefinementSession } from "../apps/agent-wiki-api/src/refinement-sessions.js";
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
after(async () => {
  await pool.end();
  await admin.end();
});
test("same-upload parts are ordered numerically; retrying or failed head blocks only its session", async () => {
  const owner = "queue-" + randomUUID(),
    ws = randomUUID(),
    upload = randomUUID();
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$2)",
    [ws, owner],
  );
  const ids = new Map<number, string>();
  await tx(owner, ws, async (c) => {
    // Deliberately shuffled insertion and identical timestamps. Part 10 must not
    // sort before part 2, nor may the random source/job UUID decide the order.
    for (const part of [10, 2, 0, 1]) {
      const source = randomUUID(),
        job = randomUUID();
      ids.set(part, job);
      await c.query(
        `INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked,metadata,created_at) VALUES($1,$2,'part','conversation','codex:same','hash','hash','unused',1,$3,true,$4,'2026-01-01')`,
        [source, ws, `upload-${upload}-${part}`, { rawUploadId: upload }],
      );
      await c.query(
        "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
        [job, ws, source],
      );
    }
  });
  await tx(owner, ws, async (c) => {
    assert.equal((await nextCurationJob(c, ws)).id, ids.get(0));
    await c.query(
      "UPDATE refinement_jobs SET available_at=now()+interval '1 hour' WHERE id=$1",
      [ids.get(0)],
    );
    assert.equal(await nextCurationJob(c, ws), null);
    await c.query("UPDATE refinement_jobs SET status='failed' WHERE id=$1", [
      ids.get(0),
    ]);
    assert.equal(await nextCurationJob(c, ws), null);
    const progress = await refinementProgress(c, ws, 0);
    assert.equal(progress.summary.eligible, 0);
    assert.equal(progress.storage.source_groups, 1);
    assert.equal(progress.storage.sources, 4);
    assert.equal(progress.storage.articles, 0);
    const source = randomUUID(),
      job = randomUUID();
    await c.query(
      `INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'other','conversation','codex:other','hash','hash','unused',1,$1::text,true)`,
      [source, ws],
    );
    await c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [job, ws, source],
    );
    assert.equal((await nextCurationJob(c, ws)).id, job);
    assert.equal((await refinementProgress(c, ws, 0)).storage.source_groups, 2);
    await c.query("UPDATE refinement_jobs SET status='completed' WHERE id=$1", [
      job,
    ]);
    const firstSource = (
      await c.query("SELECT source_id FROM refinement_jobs WHERE id=$1", [
        ids.get(0),
      ])
    ).rows[0].source_id;
    assert.equal((await retryRefinementSession(c, ws, firstSource)).retried, 1);
    assert.equal((await retryRefinementSession(c, ws, firstSource)).retried, 0);
    assert.equal((await nextCurationJob(c, ws)).id, ids.get(0));
    await c.query("UPDATE refinement_jobs SET status='completed' WHERE id=$1", [
      ids.get(0),
    ]);
    for (const part of [1, 2, 10]) {
      assert.equal((await nextCurationJob(c, ws)).id, ids.get(part));
      await c.query(
        "UPDATE refinement_jobs SET status='completed' WHERE id=$1",
        [ids.get(part)],
      );
    }
    assert.equal(await nextCurationJob(c, ws), null);
  });
});
