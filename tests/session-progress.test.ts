import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { captureBatch } from "../packages/core/src/curation-batch.js";
import { sessionProgress } from "../apps/agent-wiki-api/src/session-progress.js";
import { rebuildCuration } from "../apps/agent-wiki-api/src/curation-rebuild.js";

const owner = "progress-" + randomUUID(),
  ws = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let position = 0;
before(async () => {
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$2)",
    [ws, owner],
  );
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO collection_streams(workspace_id,id,client,session_id,name) VALUES($1,'test-stream','codex','increment','test')",
      [ws],
    ),
  );
});
after(async () => {
  await pool.end();
  await admin.end();
});
async function add(lines: number, records: number) {
  const id = randomUUID(),
    jobId = randomUUID();
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'test','conversation','codex:increment','hash','hash','not-read',$3,$1::text,true)",
      [id, ws, lines],
    );
    await c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [jobId, ws, id],
    );
    for (let i = 0; i < records; i++)
      await c.query(
        "INSERT INTO collection_events(workspace_id,stream_id,position,content_hash,source_id) VALUES($1,'test-stream',$2,$3,$4)",
        [ws, position++, randomUUID(), id],
      );
  });
  return jobId;
}
const read = () =>
  tx(owner, ws, async (c) => (await sessionProgress(c, ws))[0]);
const capture = (id: string) =>
  tx(owner, ws, async (c) =>
    captureBatch(
      c,
      ws,
      (
        await c.query(
          "SELECT * FROM refinement_jobs WHERE workspace_id=$1 AND id=$2",
          [ws, id],
        )
      ).rows[0],
    ),
  );

test("session scope stays fixed across increments, retries and model batches; completion requires committed coverage", async () => {
  const first = await add(100, 2),
    second = await add(300, 1);
  assert.equal((await read()).new_records, 3);
  assert.equal((await read()).percent, null);
  const batch = await capture(first);
  assert.equal(batch.input_sources.length, 2);
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE refinement_jobs SET chunk_plan=$3,chunk_index=1,chunk_count=2,status='running' WHERE workspace_id=$1 AND id=$2",
      [
        ws,
        first,
        {
          chunks: [
            { start: 1, end: 100 },
            { start: 101, end: 400 },
          ],
        },
      ],
    ),
  );
  assert.equal(
    (await read()).percent,
    25,
    "use covered input, not number of unequal chunks",
  );
  const next = await add(200, 2);
  let view = await read();
  assert.equal(
    view.percent,
    25,
    "new collection must not change the denominator",
  );
  assert.equal(view.new_records, 2);
  assert.equal(view.cycle_records, 3);
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE refinement_jobs SET status='failed',error_code='EVIDENCE_MISMATCH' WHERE workspace_id=$1 AND id=$2",
      [ws, first],
    ),
  );
  assert.equal((await read()).state, "attention");
  assert.equal((await read()).percent, 25);
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE refinement_jobs SET status='pending',error_code='AI_HTTP_504' WHERE workspace_id=$1 AND id=$2",
      [ws, first],
    ),
  );
  assert.equal((await read()).state, "retrying");
  assert.equal(
    (await capture(first)).cycle_id,
    batch.cycle_id,
    "retry uses the same persisted scope",
  );
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE refinement_jobs SET status='running',output='{}' WHERE workspace_id=$1 AND id=$2",
      [ws, first],
    ),
  );
  view = await read();
  assert.equal(view.state, "applying");
  assert.equal(
    view.percent,
    25,
    "uncommitted model output is not applied progress",
  );
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE refinement_jobs SET status='completed',output=NULL,updated_at=now() WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
      [ws, [first, second]],
    ),
  );
  view = await read();
  assert.equal(view.state, "waiting");
  assert.equal(
    view.percent,
    null,
    "a previous complete scope is not 100% of new work",
  );
  assert.equal(view.has_previous, true);
  assert.ok(view.reflected_at);
  const nextBatch = await capture(next);
  assert.notEqual(nextBatch.cycle_id, batch.cycle_id);
  assert.equal(nextBatch.input_sources.length, 1);
  assert.equal((await read()).percent, 0);
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE refinement_jobs SET status='completed',updated_at=now() WHERE workspace_id=$1 AND id=$2",
      [ws, next],
    ),
  );
  view = await read();
  assert.equal(view.state, "current");
  assert.equal(view.percent, 100);
  assert.equal(view.new_records, 0);
  await tx(owner, ws, (c) => rebuildCuration(c, ws, randomUUID()));
  view = await read();
  assert.equal(view.percent, null);
  assert.equal(view.new_records, 5);
  assert.equal(view.reflected_at, null);
  assert.equal(view.records, 5, "reset keeps immutable input records");
});

test("one session pass spans bounded model batches without absorbing later arrivals", async () => {
  const otherWs = randomUUID();
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$2)",
    [otherWs, owner],
  );
  await tx(owner, otherWs, async (c) => {
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      await c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'large','conversation','codex:large','hash','hash','not-read',3000,$1::text,true)",
        [id, otherWs],
      );
      await c.query(
        "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$1)",
        [id, otherWs],
      );
    }
    const jobs = (
      await c.query(
        "SELECT * FROM refinement_jobs WHERE workspace_id=$1 ORDER BY source_id",
        [otherWs],
      )
    ).rows;
    const batch = await captureBatch(c, otherWs, jobs[0]);
    assert.equal(
      batch.input_sources.length,
      1,
      "4096 line bound still applies",
    );
    const scoped = (
      await c.query("SELECT * FROM refinement_jobs WHERE workspace_id=$1", [
        otherWs,
      ])
    ).rows;
    assert.ok(scoped.every((j) => j.cycle_id === batch.cycle_id));
    await c.query(
      "UPDATE refinement_jobs SET status='completed' WHERE workspace_id=$1 AND id=$2",
      [otherWs, jobs[0].id],
    );
    assert.equal((await sessionProgress(c, otherWs))[0].percent, 50);
    assert.equal(
      (await sessionProgress(c, otherWs)).length,
      1,
      "workspace isolation",
    );
  });
});
