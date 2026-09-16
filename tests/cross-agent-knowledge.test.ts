import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, putSource } from "../packages/core/src/storage.js";
import { defaults, encryptSecret } from "../packages/core/src/ai.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import { runOne } from "../apps/agent-wiki-worker/src/worker.js";
const owner = "cross-agent-" + randomUUID(),
  ws = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const phrase = "운영 DB는 PostgreSQL을 사용한다.";
let firstId: string;
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,'Synthetic cross-agent')",
    [ws, owner],
  );
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
      [
        ws,
        { ...defaults, enabled: true, dailyCalls: null },
        encryptSecret("synthetic"),
      ],
    ),
  );
});
after(async () => {
  await pool.end();
  await admin.end();
});
async function source(
  client: string,
  phrase: string,
  role = "user",
  enqueue = false,
) {
  const id = randomUUID();
  const row = (path: string[], text: string) =>
    JSON.stringify({ event: 0, field: JSON.stringify(path), text });
  const content = [
      row(["payload", "role"], role),
      row(["payload", "content"], phrase),
    ].join("\n"),
    key = ws + "/" + hash(content) + ".txt.gz";
  await putSource(key, content);
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,$3,'conversation',$3,$4,$4,$5,2,$1::text,true)",
      [id, ws, client + ":" + id, hash(content), key],
    );
    if (enqueue)
      await c.query(
        "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
        [randomUUID(), ws, id],
      );
  });
  return { id, quote: content.split("\n")[1] };
}
function proposal(
  src: { id: string; quote: string },
  scope = "production",
  text = phrase,
) {
  return {
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "remote-worker" },
    changes: [
      {
        topic: { key: "synthetic-topic", title: "합성 검증 주제" },
        clientRef: "memory",
        title: "DB decision",
        content: text,
        kind: "memory",
        claims: [
          {
            anchor: "database",
            text,
            type: "user_decision",
            subject: "database",
            scope,
            state: "current",
            evidence: [
              {
                sourceId: src.id,
                revision: 1,
                lines: [2, 2],
                quote: src.quote,
              },
            ],
          },
        ],
      },
    ],
  };
}
const save = (payload: any) =>
  tx(owner, ws, (c) =>
    publish(c, ws, payload, { userId: owner, scope: "publish" }),
  );
test("real Worker pipeline with injected model merges Codex and Claude evidence into one knowledge Version", async () => {
  const sources = [];
  for (const client of ["codex", "claude"]) {
    const src = await source(client, phrase, "user", true);
    sources.push(src.id);
    await admin.query(
      "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
      [owner],
    );
    let called = false;
    assert.equal(
      await runOne(
        owner,
        new AbortController().signal,
        async (_config, _key, messages: any) => {
          called = true;
          const input = JSON.parse(
            (messages[1] as { content: string }).content,
          );
          if (client === "claude")
            assert.ok(input.related.some((x: any) => x.id === firstId));
          const output = proposal(src);
          output.changes[0].claims[0].evidence[0].sourceId = input.source.id;
          return {
            output: { changes: output.changes },
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          };
        },
      ),
      true,
    );
    assert.equal(called, true);
    const articles = (
      await tx(owner, ws, (c) =>
        c.query("SELECT id,revision FROM articles WHERE workspace_id=$1", [ws]),
      )
    ).rows;
    assert.equal(articles.length, 1);
    firstId = articles[0].id;
    assert.equal(articles[0].revision, client === "codex" ? 1 : 2);
  }
  const evidence = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT source_id FROM evidence WHERE workspace_id=$1 AND article_id=$2 AND revision=2",
        [ws, firstId],
      ),
    )
  ).rows;
  assert.deepEqual(new Set(evidence.map((e) => e.source_id)), new Set(sources));
  assert.equal(
    (
      await tx(owner, ws, (c) =>
        c.query(
          "SELECT count(*) FROM evidence WHERE workspace_id=$1 AND article_id=$2 AND revision=1",
          [ws, firstId],
        ),
      )
    ).rows[0].count,
    "1",
    "prior Version remains immutable",
  );
});
test("simultaneous independent sessions consolidate exact claims without lost evidence", async () => {
  const a = await source("codex", phrase),
    b = await source("claude", phrase);
  await Promise.all([save(proposal(a)), save(proposal(b))]);
  const article = (
    await tx(owner, ws, (c) =>
      c.query("SELECT id,revision FROM articles WHERE workspace_id=$1", [ws]),
    )
  ).rows;
  assert.equal(article.length, 1);
  assert.equal(article[0].revision, 4);
  assert.equal(
    (
      await tx(owner, ws, (c) =>
        c.query(
          "SELECT count(*) FROM evidence WHERE workspace_id=$1 AND article_id=$2 AND revision=4",
          [ws, firstId],
        ),
      )
    ).rows[0].count,
    "4",
  );
});
test("stale cross-session context is rejected atomically; scope differences remain separate", async () => {
  const src = await source("claude", phrase);
  const payload = {
    ...proposal(src),
    inputs: [{ articleId: firstId, revision: 1 }],
  };
  await assert.rejects(
    save(payload),
    (e: any) => e.code === "CURATION_CONTEXT_CHANGED",
  );
  await save(proposal(src, "local"));
  assert.equal(
    (
      await tx(owner, ws, (c) =>
        c.query("SELECT count(*) FROM articles WHERE workspace_id=$1", [ws]),
      )
    ).rows[0].count,
    "2",
  );
});

test("a concurrent Version change refreshes context instead of replaying stale output", async () => {
  const src = await source("claude", phrase, "user", true),
    concurrent = await source("codex", phrase);
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  await runOne(owner, new AbortController().signal, async () => {
    await save(proposal(concurrent));
    return {
      output: { changes: proposal(src).changes },
      usage: { total_tokens: 30 },
    };
  });
  const job = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM refinement_jobs WHERE workspace_id=$1 AND source_id=$2",
        [ws, src.id],
      ),
    )
  ).rows[0];
  assert.equal(job.status, "pending");
  assert.equal(job.error_code, "CURATION_CONTEXT_CHANGED");
  assert.equal(job.output, null);
  const run = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT diagnostics FROM refinement_runs WHERE workspace_id=$1 AND id=$2",
        [ws, job.run_id],
      ),
    )
  ).rows[0];
  assert.equal(run.diagnostics.retryKind, "context_refresh");
  await tx(owner, ws, (c) =>
    c.query(
      "UPDATE refinement_jobs SET available_at=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2",
      [ws, job.id],
    ),
  );
  const current = (
    await tx(owner, ws, (c) =>
      c.query("SELECT revision FROM articles WHERE workspace_id=$1 AND id=$2", [
        ws,
        firstId,
      ]),
    )
  ).rows[0].revision;
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  await runOne(
    owner,
    new AbortController().signal,
    async (_c, _k, messages) => {
      const input = JSON.parse((messages[1] as { content: string }).content);
      assert.ok(
        input.related.some(
          (r: any) => r.id === firstId && r.revision === current,
        ),
      );
      return {
        output: { changes: proposal(src).changes },
        usage: { total_tokens: 30 },
      };
    },
  );
  assert.equal(
    (
      await tx(owner, ws, (c) =>
        c.query(
          "SELECT status FROM refinement_jobs WHERE workspace_id=$1 AND id=$2",
          [ws, job.id],
        ),
      )
    ).rows[0].status,
    "completed",
  );
});

test("repeated claims inside one response do not create duplicate articles or self-publication relations", async () => {
  const text = "로그는 JSON 형식으로 기록한다.",
    a = await source("codex", text),
    b = await source("claude", text);
  const payload = proposal(a, "production", text),
    second = proposal(b, "production", text).changes[0];
  second.clientRef = "other";
  payload.changes.push(second);
  const saved = await save(payload);
  assert.equal(saved.items.length, 1);
  assert.equal(
    (
      await tx(owner, ws, (c) =>
        c.query(
          "SELECT count(*) FROM evidence WHERE workspace_id=$1 AND article_id=$2 AND revision=1",
          [ws, saved.items[0].id],
        ),
      )
    ).rows[0].count,
    "2",
  );
  const retry = await save(payload);
  assert.deepEqual(retry, saved);
});

test("Worker keeps decisions first found in one chunk as a lineage rather than latest-only text", async () => {
  const phrases = [
    "정제 Provider는 NVIDIA로 결정한다.",
    "NVIDIA 지연 때문에 Alibaba로 Provider를 바꾼다.",
  ];
  const src = await source("codex", phrases.join(" "), "user", true);
  await admin.query(
    "UPDATE model_request_gates SET next_allowed_at=now() WHERE owner_id=$1",
    [owner],
  );
  let calls = 0;
  await runOne(
    owner,
    new AbortController().signal,
    async (_config, _key, messages: any) => {
      calls++;
      const input = JSON.parse(messages[1].content);
      assert.ok(
        JSON.stringify(input.source.records).includes(phrases[0]) &&
          JSON.stringify(input.source.records).includes(phrases[1]),
      );
      return {
        output: {
          changes: phrases.map((phrase, index) => {
            const evidence = [
              {
                sourceId: input.source.id,
                revision: 1,
                lines: [2, 2],
                quote: phrase,
              },
            ];
            return {
              topic: { key: "synthetic-topic", title: "합성 검증 주제" },
              clientRef: "provider-" + index,
              title: "정제 제공자",
              content: phrase,
              kind: "memory",
              claims: [
                {
                  anchor: "provider",
                  text: phrase,
                  type: "user_decision",
                  subject: "ai-provider",
                  scope: "general",
                  state: "current",
                  evidence,
                },
              ],
              claimRelations: index
                ? [
                    {
                      anchor: "provider",
                      relation: "supersedes",
                      target: { clientRef: "provider-0", anchor: "provider" },
                      evidence,
                    },
                  ]
                : [],
            };
          }),
        },
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };
    },
  );
  const result = (
    await admin.query(
      "SELECT status,error_code,result FROM refinement_jobs WHERE workspace_id=$1 AND source_id=$2",
      [ws, src.id],
    )
  ).rows[0];
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(calls, 1);
  assert.equal(result.result.items.length, 2);
  const relations = await admin.query(
    "SELECT * FROM claim_relations WHERE workspace_id=$1 AND from_article_id=$2",
    [ws, result.result.items[1].id],
  );
  assert.equal(relations.rows[0].to_article_id, result.result.items[0].id);
  assert.equal(relations.rows[0].evidence[0].sourceId, src.id);
});
