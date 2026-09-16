import { rebuildCuration } from "../apps/agent-wiki-api/src/curation-rebuild.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, putSource } from "../packages/core/src/storage.js";
import {
  defaults,
  encryptSecret,
  ModelError,
} from "../packages/core/src/ai.js";
import { runOne } from "../apps/agent-wiki-worker/src/worker.js";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
const owner = "batch-" + randomUUID(),
  ws = randomUUID(),
  token = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let app: Awaited<ReturnType<typeof buildApp>>;
const ids: string[] = [];
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$2)",
    [ws, owner],
  );
  await admin.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
      [
        ws,
        { ...defaults, enabled: true, dailyCalls: null },
        encryptSecret("synthetic"),
      ],
    );
    for (const [i, text] of [
      "첫 결정은 로컬 서버다.",
      "변경 결정은 원격 서버다.",
    ].entries()) {
      const id = randomUUID(),
        content = JSON.stringify({ event: i, role: "user", text }),
        key = ws + "/" + hash(content) + ".txt.gz";
      ids.push(id);
      await putSource(key, content);
      await c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked,created_at) VALUES($1::uuid,$2,'session','conversation','codex:batch',$3,$3,$4,1,$1::text,true,now()+make_interval(secs=>$5))",
        [id, ws, hash(content), key, i],
      );
      await c.query(
        "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
        [randomUUID(), ws, id],
      );
    }
  });
  app = await buildApp();
});
after(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
test("small increments of one session share a model call and keep separate immutable evidence", async () => {
  let calls = 0;
  await runOne(
    owner,
    new AbortController().signal,
    async (_config, _key, messages) => {
      calls++;
      const input = JSON.parse((messages[1] as { content: string }).content);
      assert.ok(
        JSON.stringify(input.source.records).includes("첫 결정"),
        "first input missing",
      );
      assert.ok(
        JSON.stringify(input.source.records).includes("변경 결정"),
        "second increment must join the first call",
      );
      const lines = input.source.records;
      return {
        output: {
          changes: lines.map((line: any, i: number) => ({
            topic: { key: "synthetic-topic", title: "합성 검증 주제" },
            clientRef: "item-" + i,
            title: "기록 " + i,
            content: line.text,
            kind: "memory",
            claims: [
              {
                anchor: "claim",
                text: line.text,
                type: "user_decision",
                subject: "server",
                scope: "local",
                state: "current",
                evidence: [{ recordId: line.recordId }],
              },
            ],
          })),
        },
        usage: { total_tokens: 30 },
      };
    },
  );
  assert.equal(calls, 1);
  const jobs = await tx(owner, ws, (c) =>
    c.query("SELECT status FROM refinement_jobs WHERE workspace_id=$1", [ws]),
  );
  assert.ok(jobs.rows.every((j) => j.status === "completed"));
  const evidence = await tx(owner, ws, (c) =>
    c.query(
      "SELECT source_id,line_start,line_end FROM evidence WHERE workspace_id=$1",
      [ws],
    ),
  );
  assert.deepEqual(
    new Set(evidence.rows.map((e) => e.source_id)),
    new Set(ids),
  );
  assert.ok(evidence.rows.every((e) => e.line_start === 1 && e.line_end === 1));
});
test("call history excludes skipped and publish-only executions before pagination", async () => {
  const job = (
    await tx(owner, ws, (c) =>
      c.query("SELECT id FROM refinement_jobs WHERE workspace_id=$1 LIMIT 1", [
        ws,
      ]),
    )
  ).rows[0].id;
  const called = randomUUID(),
    skipped = randomUUID();
  await tx(owner, ws, async (c) => {
    for (const [id, diagnostics] of [
      [called, { requestedAt: new Date().toISOString(), httpRequests: 1 }],
      [skipped, { skippedReason: "omitted_fields_only", httpRequests: 0 }],
    ])
      await c.query(
        "INSERT INTO refinement_runs(id,workspace_id,job_id,settings,prompt_version,status,diagnostics) VALUES($1,$2,$3,$4,'test','completed',$5)",
        [id, ws, job, defaults, diagnostics],
      );
  });
  const response = await app.inject({
    method: "GET",
    url: `/api/workspaces/${ws}/refinements`,
    headers: { cookie: "wiki_session=" + token },
  });
  assert.equal(response.statusCode, 200, response.body);
  const runs = response.json().runs;
  assert.ok(runs.some((r: any) => r.id === called));
  assert.ok(
    !runs.some((r: any) => r.id === skipped),
    "skipped execution shown as model call",
  );
});

async function appendInput(
  text: string,
  session = "codex:retry-batch",
  lineCount = 1,
) {
  const id = randomUUID(),
    job = randomUUID(),
    content = JSON.stringify({ event: randomUUID(), text }),
    key = ws + "/" + hash(content) + ".txt.gz";
  await putSource(key, content);
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'batch',$3,$4,$5,$5,$6,$7,$1::text,true)",
      [id, ws, "conversation", session, hash(content), key, lineCount],
    );
    await c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [job, ws, id],
    );
  });
  return { id, job };
}
async function ready() {
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  await admin.query(
    "UPDATE refinement_jobs SET available_at=now() WHERE workspace_id=$1 AND status='pending'",
    [ws],
  );
}
test("failed batch retries the frozen input; an arrival during the call waits for the next batch", async () => {
  const first = await appendInput("batch-first"),
    second = await appendInput("batch-second");
  await ready();
  let initial = "",
    late: { id: string; job: string } | undefined;
  await runOne(owner, new AbortController().signal, async (_c, _k, m) => {
    initial = JSON.stringify(
      JSON.parse((m[1] as { content: string }).content).source.records,
    );
    late = await appendInput("arrived-after-capture");
    throw new ModelError("AI_HTTP_429", true, 1);
  });
  assert.ok(
    initial.includes("batch-first") && initial.includes("batch-second"),
  );
  const captured = (
    await admin.query(
      "SELECT input_sources,chunk_index,status FROM refinement_jobs WHERE id=$1",
      [first.job],
    )
  ).rows[0];
  assert.equal(captured.input_sources.length, 2);
  assert.equal(captured.chunk_index, 0);
  assert.equal(captured.status, "pending");
  assert.equal(
    await runOne(owner, new AbortController().signal, async () => {
      throw Error("cooldown bypass");
    }),
    false,
  );
  await ready();
  let retried = "";
  await runOne(owner, new AbortController().signal, async (_c, _k, m) => {
    retried = JSON.stringify(
      JSON.parse((m[1] as { content: string }).content).source.records,
    );
    return { output: { changes: [] }, usage: { total_tokens: 1 } };
  });
  assert.equal(retried, initial);
  assert.equal(
    (
      await admin.query("SELECT status FROM refinement_jobs WHERE id=$1", [
        second.job,
      ])
    ).rows[0].status,
    "completed",
  );
  assert.equal(
    (
      await admin.query("SELECT status FROM refinement_jobs WHERE id=$1", [
        late!.job,
      ])
    ).rows[0].status,
    "pending",
  );
  await ready();
  let next = "";
  await runOne(owner, new AbortController().signal, async (_c, _k, m) => {
    next = JSON.stringify(
      JSON.parse((m[1] as { content: string }).content).source.records,
    );
    return { output: { changes: [] }, usage: { total_tokens: 1 } };
  });
  assert.ok(next.includes("arrived-after-capture"));
  assert.ok(!next.includes("batch-first"));
});
test("capture is bounded, does not cross sessions, and rebuild clears membership without deleting sources", async () => {
  const first = await appendInput("bounded-first", "codex:bounded", 3000);
  const second = await appendInput("bounded-second", "codex:bounded", 2000);
  const other = await appendInput("other-session", "codex:other");
  await ready();
  await runOne(owner, new AbortController().signal, async (_c, _k, m) => {
    const text = JSON.stringify(
      JSON.parse((m[1] as { content: string }).content).source.records,
    );
    assert.ok(text.includes("bounded-first"));
    assert.ok(!text.includes("bounded-second"));
    assert.ok(!text.includes("other-session"));
    return { output: { changes: [] }, usage: { total_tokens: 1 } };
  });
  const rows = (
    await admin.query(
      "SELECT id,status FROM refinement_jobs WHERE id=ANY($1::uuid[])",
      [[first.job, second.job, other.job]],
    )
  ).rows;
  assert.equal(rows.find((r) => r.id === first.job).status, "completed");
  assert.equal(rows.find((r) => r.id === second.job).status, "pending");
  assert.equal(rows.find((r) => r.id === other.job).status, "pending");
  await tx(owner, ws, async (c) => {
    await c.query(
      "UPDATE ai_settings SET config=jsonb_set(config,'{enabled}','false') WHERE workspace_id=$1",
      [ws],
    );
    const count = (
      await c.query(
        "SELECT count(*)::int AS n FROM sources WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0].n;
    await rebuildCuration(c, ws, randomUUID());
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM sources WHERE workspace_id=$1",
          [ws],
        )
      ).rows[0].n,
      count,
    );
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM refinement_jobs WHERE workspace_id=$1 AND (batch_parent IS NOT NULL OR input_sources IS NOT NULL)",
          [ws],
        )
      ).rows[0].n,
      0,
    );
  });
});
