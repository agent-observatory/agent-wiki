import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, getSource } from "../packages/core/src/storage.js";
import { runOne } from "../apps/agent-wiki-worker/src/worker.js";
import { defaults, encryptSecret } from "../packages/core/src/ai.js";
import { refinementProgress } from "../apps/agent-wiki-api/src/refinement-progress.js";
import {
  queueCuration,
  rebuildCuration,
} from "../apps/agent-wiki-api/src/curation-rebuild.js";
const owner = "rebuild-" + randomUUID(),
  token = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const headers = {
  cookie: "wiki_session=" + token,
  origin: "http://localhost:3000",
};
let app: Awaited<ReturnType<typeof buildApp>>;
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  app = await buildApp();
});
after(async () => {
  await app.close();
  await pool.end();
  await admin.end();
});
async function space() {
  return (
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers,
      payload: { name: "Rebuild fixture" },
    })
  ).json().id as string;
}
async function call(ws: string, path: string, payload: any) {
  return app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}${path}`,
    headers,
    payload,
  });
}
async function collect(ws: string, start = 0) {
  const r = await call(ws, "/collection", {
    machine: "fixture",
    client: "codex",
    sessionId: "session",
    name: "Synthetic",
    start,
    records: [
      JSON.stringify({ role: "user", content: "테스트 지식을 보존한다." }),
    ],
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
test("rebuild keeps L1, collection position, settings, rate gates and attempt history; retries are idempotent", async () => {
  const ws = await space(),
    unrelated = await space();
  const first = await collect(ws),
    other = await collect(unrelated);
  const run = randomUUID();
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,'synthetic-encrypted')",
      [ws, defaults],
    );
    await c.query(
      "UPDATE refinement_jobs SET status='completed',chunk_index=2,chunk_count=2,chunk_results='[{\"chunk\":0}]',result='{}' WHERE id=$1",
      [first.jobId],
    );
    await c.query(
      "INSERT INTO refinement_runs(id,workspace_id,job_id,settings,prompt_version,status,usage,finished_at) VALUES($1,$2,$3,'{}','old','completed','{\"total_tokens\":17}',now())",
      [run, ws, first.jobId],
    );
    await c.query(
      "INSERT INTO model_request_gates(owner_id,key_hash,failures,next_allowed_at) VALUES($1,'rebuild-fixture',2,now()+interval '1 hour') ON CONFLICT DO NOTHING",
      [owner],
    );
  });
  const source = (
    await admin.query("SELECT * FROM sources WHERE id=$1", [first.sourceId])
  ).rows[0];
  const text = await getSource(source.object_key),
    line = text.split("\n")[0];
  const publication = await call(ws, "/publications", {
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "fixture" },
    changes: [
      {
        topic: { key: "synthetic-topic", title: "합성 검증 주제" },
        clientRef: "test",
        title: "Synthetic knowledge",
        content: "테스트 지식",
        claims: [
          {
            anchor: "a",
            text: "테스트 지식",
            type: "agent_statement",
            evidence: [
              {
                sourceId: first.sourceId,
                revision: 1,
                lines: [1, 1],
                quote: line,
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(publication.statusCode, 200, publication.body);
  const settingsBefore = (
    await admin.query("SELECT * FROM ai_settings WHERE workspace_id=$1", [ws])
  ).rows;
  const streamBefore = (
    await admin.query(
      "SELECT * FROM collection_streams WHERE workspace_id=$1",
      [ws],
    )
  ).rows;
  const gateBefore = (
    await admin.query("SELECT * FROM model_request_gates WHERE owner_id=$1", [
      owner,
    ])
  ).rows;
  assert.ok(
    (await tx(owner, ws, (c) => refinementProgress(c, ws, 0))).lastProgressAt,
  );
  const requestId = randomUUID();
  const r = await call(ws, "/curation/rebuild", { requestId });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), {
    id: requestId,
    sources: 1,
    queued: 1,
    unqueued: 0,
    removedArticles: 1,
    enabled: false,
  });
  assert.deepEqual(
    (await admin.query("SELECT * FROM sources WHERE id=$1", [source.id]))
      .rows[0],
    source,
  );
  assert.equal(await getSource(source.object_key), text);
  assert.deepEqual(
    (
      await admin.query(
        "SELECT * FROM collection_streams WHERE workspace_id=$1",
        [ws],
      )
    ).rows,
    streamBefore,
  );
  assert.deepEqual(
    (await admin.query("SELECT * FROM ai_settings WHERE workspace_id=$1", [ws]))
      .rows,
    settingsBefore,
  );
  assert.deepEqual(
    (
      await admin.query("SELECT * FROM model_request_gates WHERE owner_id=$1", [
        owner,
      ])
    ).rows,
    gateBefore,
  );
  for (const table of [
    "articles",
    "publications",
    "evidence",
    "claims",
    "revisions",
  ])
    assert.equal(
      (
        await admin.query(
          `SELECT count(*)::int n FROM ${table} WHERE workspace_id=$1`,
          [ws],
        )
      ).rows[0].n,
      0,
    );
  const job = (
    await admin.query("SELECT * FROM refinement_jobs WHERE id=$1", [
      first.jobId,
    ])
  ).rows[0];
  assert.equal(job.generation, 1);
  assert.equal(
    (await tx(owner, ws, (c) => refinementProgress(c, ws, 0))).lastProgressAt,
    null,
  );
  assert.equal(job.status, "pending");
  assert.equal(job.chunk_index, 0);
  assert.equal(job.output, null);
  assert.deepEqual(
    (await admin.query("SELECT usage FROM refinement_runs WHERE id=$1", [run]))
      .rows[0].usage,
    { total_tokens: 17 },
  );
  assert.equal(
    (
      await admin.query("SELECT generation FROM refinement_jobs WHERE id=$1", [
        other.jobId,
      ])
    ).rows[0].generation,
    0,
  );
  await collect(ws, 1);
  assert.deepEqual(
    (await call(ws, "/curation/rebuild", { requestId })).json(),
    r.json(),
  );
  assert.equal(
    (
      await admin.query("SELECT generation FROM refinement_jobs WHERE id=$1", [
        first.jobId,
      ])
    ).rows[0].generation,
    1,
  );
  assert.equal(
    (await collect(ws, 0)).accepted,
    0,
    "collector retries remain duplicates",
  );
});
test("a scoped rebuild only re-queues the given sources, reports queued/unqueued, and wipes the Consolidation tables too", async () => {
  const ws = await space();
  const a = await collect(ws, 0),
    b = await collect(ws, 1);
  const source = (
    await admin.query("SELECT object_key FROM sources WHERE id=$1", [
      a.sourceId,
    ])
  ).rows[0];
  const text = await getSource(source.object_key),
    line = text.split("\n")[0];
  const publication = await call(ws, "/publications", {
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "fixture" },
    changes: [
      {
        topic: { key: "scoped-rebuild-topic", title: "Scoped rebuild" },
        clientRef: "test",
        title: "Scoped rebuild claim",
        content: "격리 재정제 검증용 주장",
        claims: [
          {
            anchor: "a",
            text: "격리 재정제 검증용 주장",
            type: "agent_statement",
            evidence: [
              { sourceId: a.sourceId, revision: 1, lines: [1, 1], quote: line },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(publication.statusCode, 200, publication.body);
  const articleId = publication.json().items[0].id as string,
    publicationId = publication.json().id as string;
  // Seed every Consolidation table a rebuild must wipe, plus a
  // refinement_runs row that dangles a reference to the doomed Job.
  const consolidationJob = randomUUID();
  await admin.query(
    "INSERT INTO consolidation_jobs(id,workspace_id,topic_key,trigger) VALUES($1,$2,'scoped-rebuild-topic','manual')",
    [consolidationJob, ws],
  );
  const run = randomUUID();
  await admin.query(
    "INSERT INTO refinement_runs(id,workspace_id,kind,consolidation_job_id,settings,prompt_version,status) VALUES($1,$2,'consolidation',$3,'{}','consolidation-1','completed')",
    [run, ws, consolidationJob],
  );
  await admin.query(
    "INSERT INTO consolidation_inbox(workspace_id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation,evidence,error_code) VALUES($1,$2,1,'a',$2,1,'a','supports','[]','CLAIM_TARGET_VERSION_CHANGED')",
    [ws, articleId],
  );
  await admin.query(
    "INSERT INTO claim_relation_rejections(workspace_id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation,reason,publication_id) VALUES($1,$2,1,'a',$2,1,'a','supports','test',$3)",
    [ws, articleId, publicationId],
  );
  const requestId = randomUUID();
  const r = await call(ws, "/curation/rebuild", {
    requestId,
    sourceIds: [a.sourceId],
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), {
    id: requestId,
    sources: 2,
    queued: 1,
    unqueued: 1,
    removedArticles: 1,
    enabled: false,
  });
  const jobA = (
    await admin.query("SELECT * FROM refinement_jobs WHERE source_id=$1", [
      a.sourceId,
    ])
  ).rows[0];
  assert.equal(jobA.status, "pending");
  assert.equal(jobA.generation, 1);
  assert.equal(
    (
      await admin.query("SELECT * FROM refinement_jobs WHERE source_id=$1", [
        b.sourceId,
      ])
    ).rowCount,
    0,
    "the unscoped source loses its job row",
  );
  assert.equal(
    (await admin.query("SELECT 1 FROM sources WHERE id=$1", [b.sourceId]))
      .rowCount,
    1,
    "the unscoped source keeps its immutable L1 object",
  );
  for (const table of [
    "consolidation_jobs",
    "consolidation_inbox",
    "claim_relation_rejections",
  ])
    assert.equal(
      (
        await admin.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,
          [ws],
        )
      ).rows[0].n,
      0,
      table + " is wiped by a rebuild",
    );
  assert.equal(
    (
      await admin.query(
        "SELECT consolidation_job_id FROM refinement_runs WHERE id=$1",
        [run],
      )
    ).rows[0].consolidation_job_id,
    null,
    "call history for the consolidation Job is kept, but its dangling reference is cleared",
  );
});
test("active or finishing curation is rejected; failed resets roll back and access is session scoped", async () => {
  const ws = await space();
  const first = await collect(ws);
  await tx(owner, ws, (c) =>
    c.query("INSERT INTO ai_settings(workspace_id,config) VALUES($1,$2)", [
      ws,
      { ...defaults, enabled: true },
    ]),
  );
  assert.equal(
    (await call(ws, "/curation/rebuild", { requestId: randomUUID() })).json()
      .error,
    "CURATION_PAUSE_REQUIRED",
  );
  await tx(owner, ws, async (c) => {
    await c.query("UPDATE ai_settings SET config=$2 WHERE workspace_id=$1", [
      ws,
      defaults,
    ]);
    await c.query("UPDATE refinement_jobs SET status='running' WHERE id=$1", [
      first.jobId,
    ]);
  });
  assert.equal(
    (await call(ws, "/curation/rebuild", { requestId: randomUUID() })).json()
      .error,
    "CURATION_STILL_RUNNING",
  );
  await tx(owner, ws, (c) =>
    c.query("UPDATE refinement_jobs SET status='pending' WHERE id=$1", [
      first.jobId,
    ]),
  );
  await assert.rejects(
    tx(owner, ws, async (c) => {
      await rebuildCuration(c, ws, randomUUID());
      throw new Error("simulate transaction failure");
    }),
  );
  assert.equal(
    (
      await admin.query("SELECT generation FROM refinement_jobs WHERE id=$1", [
        first.jobId,
      ])
    ).rows[0].generation,
    0,
  );
  const key = (
    await call(ws, "/keys", { name: "fixture", scope: "publish" })
  ).json().token;
  const denied = await app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}/curation/rebuild`,
    headers: { authorization: "Bearer " + key },
    payload: { requestId: randomUUID() },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(
    (await call(randomUUID(), "/curation/rebuild", { requestId: randomUUID() }))
      .statusCode,
    404,
  );
});

test("a late response from an expired execution cannot publish after rebuild", async () => {
  const ws = await space();
  const first = await collect(ws);
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
      [
        ws,
        { ...defaults, enabled: true },
        encryptSecret("late-response-fixture"),
      ],
    ),
  );
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>((r) => {
    enter = r;
  });
  const finished = new Promise<void>((r) => {
    finish = r;
  });
  const worker = runOne(owner, new AbortController().signal, async () => {
    enter();
    await finished;
    return { output: { changes: [] }, usage: { total_tokens: 7 } };
  });
  await entered;
  await tx(owner, ws, async (c) => {
    await c.query("UPDATE ai_settings SET config=$2 WHERE workspace_id=$1", [
      ws,
      defaults,
    ]);
    // Simulate lease recovery while the provider's old response is still delayed.
    await c.query(
      "UPDATE refinement_jobs SET status='pending',lease_until=NULL WHERE id=$1",
      [first.jobId],
    );
  });
  const reset = await call(ws, "/curation/rebuild", {
    requestId: randomUUID(),
  });
  assert.equal(reset.statusCode, 200, reset.body);
  finish();
  await worker;
  const job = (
    await admin.query("SELECT * FROM refinement_jobs WHERE id=$1", [
      first.jobId,
    ])
  ).rows[0];
  assert.equal(job.generation, 1);
  assert.equal(job.status, "pending");
  assert.equal(job.chunk_index, 0);
  assert.equal(job.run_id, null);
  assert.equal(job.output, null);
  const run = (
    await admin.query(
      "SELECT error_code,usage FROM refinement_runs WHERE job_id=$1",
      [first.jobId],
    )
  ).rows[0];
  assert.equal(run.error_code, "LEASE_LOST");
  assert.equal(run.usage.total_tokens, 7);
});

// A scoped rebuild leaves sources with raw L1 and no job, honestly reported as
// uncurated. Without a way back in that honesty is a dead end: the only other
// path was another rebuild, which wipes L3 including the user's feedback.
test("curation queue re-enters uncurated sources without touching knowledge", async () => {
  const qWs = randomUUID();
  await admin.query("INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)", [
    qWs,
    owner,
    "Queue back in",
  ]);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    ids.push(id);
    await admin.query(
      `INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked)
       VALUES($1,$2,$3,'conversation','synthetic','h','p','k',1,$4,true)`,
      [id, qWs, "s" + i, id],
    );
  }
  // One already curated, two left behind by a scoped rebuild.
  await admin.query(
    "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
    [randomUUID(), qWs, ids[0]],
  );
  const first = await tx(owner, qWs, (c) => queueCuration(c, qWs));
  assert.deepEqual(first, { queued: 2, stillUnqueued: 0 });
  // Idempotent: a second call queues nothing and creates no duplicate row.
  const second = await tx(owner, qWs, (c) => queueCuration(c, qWs));
  assert.deepEqual(second, { queued: 0, stillUnqueued: 0 });
  const jobs = (
    await admin.query(
      "SELECT count(*)::int n FROM refinement_jobs WHERE workspace_id=$1",
      [qWs],
    )
  ).rows[0].n;
  assert.equal(jobs, 3, "one job per source, no duplicates");
});
