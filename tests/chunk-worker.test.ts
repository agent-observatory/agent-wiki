import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import { pool, tx } from "../packages/core/src/db.js";
import { putSource, hash } from "../packages/core/src/storage.js";
import {
  defaults,
  encryptSecret,
  ModelError,
} from "../packages/core/src/ai.js";
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
    const input = JSON.parse(
      z.object({ content: z.string() }).parse(m[1]).content,
    );
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
  const failedRun = (
    await tx(owner, ws, (c) =>
      c.query("SELECT * FROM refinement_runs WHERE id=$1", [row.run_id]),
    )
  ).rows[0];
  assert.equal(failedRun.diagnostics.stage, "validate");
  assert.equal(failedRun.diagnostics.retryable, false);
  assert.equal(failedRun.diagnostics.retryAt, null);
  assert.ok(failedRun.diagnostics.durationMs >= 0);
  assert.ok(failedRun.diagnostics.requestedAt);

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

test("publish-only recovery preserves the failed execution and makes no model call", async () => {
  const originalRun = randomUUID();
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO refinement_runs(id,workspace_id,job_id,settings,prompt_version,status,error_code,diagnostics) VALUES($1,$2,$3,$4,'test','failed','WORKER_STOPPED',$5)",
      [
        originalRun,
        ws,
        job,
        defaults,
        {
          version: 1,
          stage: "publish",
          requestedAt: new Date().toISOString(),
          httpStatus: 200,
          durationMs: 1000,
        },
      ],
    );
    await c.query(
      "UPDATE refinement_jobs SET status='pending',output=$2,run_id=$3,chunk_index=0,chunk_count=1,available_at=now() WHERE id=$1",
      [job, { changes: [] }, originalRun],
    );
  });
  await runOne(owner, new AbortController().signal, async () => {
    throw new Error("recovery must not invoke provider");
  });
  const runs = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT id,status,error_code,diagnostics FROM refinement_runs WHERE job_id=$1 ORDER BY created_at DESC",
        [job],
      ),
    )
  ).rows;
  assert.equal(runs[0].status, "completed");
  assert.equal(runs[0].diagnostics.recoveryOf, originalRun);
  assert.equal(runs[0].diagnostics.requestedAt, undefined);
  const original = runs.find((r) => r.id === originalRun);
  assert.equal(original.status, "failed");
  assert.equal(original.error_code, "WORKER_STOPPED");
  assert.equal(original.diagnostics.durationMs, 1000);
});

test("incremental curation sees prior claim context and adds a grounded replacement without overwriting the old article", async () => {
  const { publish } = await import("../apps/agent-wiki-api/src/knowledge.js");
  const oldText = "Supabase를 운영 DB로 채택한다.",
    newText = "Supabase를 취소하고 OCI PostgreSQL을 운영 DB로 채택한다.";
  async function addSource(text: string) {
    const id = randomUUID(),
      h = hash(text),
      key = ws + "/" + h + ".txt.gz";
    await putSource(key, text);
    await tx(owner, ws, (c) =>
      c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'decision','conversation','synthetic',$3,$3,$4,$6,$5,true)",
        [id, ws, h, key, randomUUID(), text.split("\n").length],
      ),
    );
    return id;
  }
  const first = await addSource(oldText),
    second = await addSource(
      [
        JSON.stringify({
          event: 1,
          field: JSON.stringify(["payload", "role"]),
          text: "user",
        }),
        JSON.stringify({
          event: 1,
          field: JSON.stringify(["payload", "message"]),
          text: newText,
        }),
      ].join("\n"),
    );
  const previous = await tx(owner, ws, (c) =>
    publish(
      c,
      ws,
      {
        idempotencyKey: randomUUID(),
        producer: { type: "agent", client: "synthetic" },
        changes: [
          {
            clientRef: "a",
            title: "운영 데이터베이스",
            content: oldText,
            claims: [
              {
                anchor: "db",
                text: oldText,
                type: "user_decision",
                subject: "database",
                scope: "production",
                state: "current",
                evidence: [
                  {
                    sourceId: first,
                    revision: 1,
                    lines: [1, 1],
                    quote: oldText,
                  },
                ],
              },
            ],
          },
        ],
      },
      { userId: owner, scope: "session" },
    ),
  );
  const old = previous.items[0].id,
    newJob = randomUUID();
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [newJob, ws, second],
    ),
  );
  await releaseGate();
  await runOne(owner, new AbortController().signal, async (_c, _k, m) => {
    const input = JSON.parse(
      z.object({ content: z.string() }).parse(m[1]).content,
    );
    const prior = input.related.find((a: any) => a.id === old);
    assert.equal(prior.text, oldText);
    assert.equal(prior.same_session, true);
    assert.equal(prior.scope, "production");
    const evidence = {
      sourceId: second,
      revision: 1,
      lines: [2, 2],
      quote: input.source.text.split("\n")[1],
    };
    return {
      output: {
        changes: [
          {
            clientRef: "b",
            title: "새 운영 DB",
            content: newText,
            claims: [
              {
                anchor: "db",
                text: newText,
                type: "user_decision",
                subject: "database",
                scope: "production",
                state: "current",
                evidence: [evidence],
              },
            ],
            claimRelations: [
              {
                anchor: "db",
                relation: "supersedes",
                target: { articleId: old, revision: 1, anchor: "db" },
                evidence: [evidence],
              },
            ],
          },
        ],
      },
      usage: { total_tokens: 50 },
    };
  });
  const result = await tx(owner, ws, async (c) => ({
    job: (
      await c.query(
        "SELECT status,error_code FROM refinement_jobs WHERE id=$1",
        [newJob],
      )
    ).rows[0],
    article: (
      await c.query("SELECT revision,content FROM articles WHERE id=$1", [old])
    ).rows[0],
    relations: (
      await c.query("SELECT * FROM claim_relations WHERE to_article_id=$1", [
        old,
      ])
    ).rows,
  }));
  assert.equal(result.job.status, "completed", JSON.stringify(result.job));
  assert.equal(result.article.revision, 1);
  assert.equal(result.article.content, oldText);
  assert.equal(result.relations.length, 1);
  const assistantText = "PostgreSQL 설치를 완료했습니다. 검증 결과는 없습니다.";
  const assistantSource = await addSource(
    [
      JSON.stringify({
        event: 2,
        field: JSON.stringify(["payload", "role"]),
        text: "assistant",
      }),
      JSON.stringify({
        event: 2,
        field: JSON.stringify(["payload", "message"]),
        text: assistantText,
      }),
    ].join("\n"),
  );
  const assistantJob = randomUUID();
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
      [assistantJob, ws, assistantSource],
    ),
  );
  await releaseGate();
  await runOne(owner, new AbortController().signal, async (_c, _k, m) => {
    const input = JSON.parse(
      z.object({ content: z.string() }).parse(m[1]).content,
    );
    assert.ok(input.source.roles.every((r: any) => r.role === "assistant"));
    const target = input.related.find(
      (a: any) => a.id === result.relations[0].from_article_id,
    );
    const evidence = {
      sourceId: assistantSource,
      revision: 1,
      lines: [2, 2],
      quote: input.source.text.split("\n")[1],
    };
    return {
      output: {
        changes: [
          {
            clientRef: "unsafe",
            title: "설치 완료 주장",
            content: assistantText,
            claims: [
              {
                anchor: "installed",
                text: assistantText,
                type: "user_decision",
                subject: "database",
                scope: "production",
                state: "current",
                evidence: [evidence],
              },
            ],
            claimRelations: [
              {
                anchor: "installed",
                relation: "supersedes",
                target: {
                  articleId: target.id,
                  revision: target.revision,
                  anchor: target.anchor,
                },
                evidence: [evidence],
              },
            ],
          },
        ],
      },
      usage: { total_tokens: 20 },
    };
  });
  const guarded = await tx(owner, ws, async (c) => ({
    claims: (
      await c.query(
        "SELECT cl.type,cl.state FROM claims cl JOIN evidence e USING(workspace_id,article_id,revision,anchor) WHERE e.source_id=$1",
        [assistantSource],
      )
    ).rows,
    relations: (
      await c.query(
        "SELECT count(*)::int AS n FROM claim_relations WHERE to_article_id=$1",
        [result.relations[0].from_article_id],
      )
    ).rows[0].n,
    diagnostics: (
      await c.query(
        "SELECT diagnostics FROM refinement_runs WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1",
        [assistantJob],
      )
    ).rows[0].diagnostics,
  }));
  assert.deepEqual(guarded.claims, [
    { type: "unconfirmed", state: "unconfirmed" },
  ]);
  assert.equal(guarded.relations, 0);
  assert.equal(guarded.diagnostics.unconfirmedClaims, 1);
});
