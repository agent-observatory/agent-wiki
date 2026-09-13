import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, putSource } from "../packages/core/src/storage.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
const owner = "query-" + randomUUID(),
  ws = randomUUID(),
  other = randomUUID(),
  token = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let app: Awaited<ReturnType<typeof buildApp>>,
  old: string,
  newer: string,
  sourceId: string;
const headers = { cookie: "wiki_session=" + token };
const api = (path: string) =>
  app.inject({ url: "/api/workspaces/" + ws + path, headers });
const read = (sql: string, args: any[] = []) =>
  tx(owner, ws, (c) => c.query(sql, args));
async function add(
  title: string,
  text: string,
  scope: string,
  target?: string,
  state = "current",
) {
  const src = randomUUID(),
    raw = [
      JSON.stringify({ event: 1, field: '["payload","role"]', text: "user" }),
      JSON.stringify({ event: 1, field: '["payload","content"]', text }),
    ].join("\n"),
    key = ws + "/" + hash(raw) + ".txt.gz";
  await putSource(key, raw);
  await read(
    "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,'synthetic','conversation',$1::text,$3,$3,$4,2,$1::text,true)",
    [src, ws, hash(raw), key],
  );
  const e = {
    sourceId: src,
    revision: 1,
    lines: [2, 2],
    quote: raw.split("\n")[1],
  };
  const p: any = {
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "codex" },
    changes: [
      {
        clientRef: "m",
        topic: { key: "ai-provider", title: "AI 제공자" },
        title,
        content: text,
        kind: "memory",
        claims: [
          {
            anchor: "provider",
            text,
            type: "user_decision",
            subject: "provider",
            scope,
            state,
            evidence: [e],
          },
        ],
      },
    ],
  };
  if (target)
    p.changes[0].claimRelations = [
      {
        anchor: "provider",
        relation: "supersedes",
        target: { articleId: target, revision: 1, anchor: "provider" },
        evidence: [e],
      },
    ];
  const result = await tx(owner, ws, (c) =>
    publish(c, ws, p, { userId: owner, scope: "publish" }),
  );
  return { id: result.items[0].id, sourceId: src };
}
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$3,'query'),($2,$3,'other')",
    [ws, other, owner],
  );
  await read(
    "INSERT INTO ai_settings(workspace_id,config) VALUES($1,'{\"enabled\":false}')",
    [ws],
  );
  old = (
    await add(
      "NVIDIA 초기 결정",
      "NVIDIA를 정제 제공자로 사용한다.",
      "production",
    )
  ).id;
  const n = await add(
    "Alibaba 현재 결정",
    "호출 장애 때문에 NVIDIA를 취소하고 Alibaba를 사용한다.",
    "production",
    old,
  );
  newer = n.id;
  sourceId = n.sourceId;
  await add("로컬 제공자", "로컬은 별도 제공자를 사용한다.", "local");
  await add(
    "제공자 검토 의견",
    "다른 제공자도 검토해보자.",
    "proposal",
    undefined,
    "proposed",
  );
  app = await buildApp();
});
after(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
test("current follows replacement, history retains both, exact scopes and overview are distinct", async () => {
  const r = await api("/query?q=NVIDIA&view=current");
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().items.some((x: any) => x.ref.articleId === newer));
  assert.ok(!r.json().items.some((x: any) => x.ref.articleId === old));
  const h = (await api("/query?q=NVIDIA&view=history")).json();
  assert.ok(
    h.items.some(
      (x: any) => x.ref.articleId === old && x.state === "superseded",
    ),
  );
  const scope = (
    await api("/query?q=" + encodeURIComponent("제공자") + "&scope=local")
  ).json();
  assert.ok(scope.items.length);
  assert.ok(scope.items.every((x: any) => x.scope === "local"));
  const overview = (await api("/query?q=NVIDIA&view=overview")).json();
  assert.equal(overview.items[0].title, "AI 제공자");
  assert.equal(overview.items[0].discoveryOnly, true);
  const proposal = (
    await api("/query?q=" + encodeURIComponent("검토 의견"))
  ).json();
  assert.ok(proposal.items.some((x: any) => x.state === "proposed"));
});
test("same trace connects seed, selected claim, exact relation evidence and source; telemetry has no text", async () => {
  const start = (await api("/query?q=Alibaba")).json(),
    trace = start.traceId;
  const claim = await api(
    `/query/claims/${newer}?revision=1&anchor=provider&depth=1&traceId=${trace}`,
  );
  assert.equal(claim.statusCode, 200, claim.body);
  const d = claim.json();
  assert.equal(d.claim.ref.articleId, newer);
  assert.equal(d.nodes[0].ref.articleId, old);
  assert.equal(d.nodes[0].state, "superseded");
  assert.equal(d.relations[0].from.articleId, newer);
  assert.equal(d.relations[0].to.articleId, old);
  assert.equal(d.relations[0].evidence[0].sourceId, sourceId);
  const source = await api(
    `/query/sources/${sourceId}?start=2&end=2&traceId=${trace}`,
  );
  assert.equal(source.statusCode, 200, source.body);
  assert.ok(source.json().text.includes("호출 장애"));
  const audit = (await api("/query/traces/" + trace)).json();
  assert.equal(audit.steps, 3);
  assert.equal(audit.serverModelCalls, 0);
  assert.equal(audit.l5Usage, null);
  assert.ok(audit.responseChars > 0);
  const rows = (
    await read(
      "SELECT * FROM retrieval_events WHERE workspace_id=$1 AND trace_id=$2",
      [ws, trace],
    )
  ).rows;
  assert.ok(!JSON.stringify(rows).includes("호출 장애"));
  assert.ok(!JSON.stringify(rows).includes("Alibaba"));
  assert.equal(
    rows.find((x) => x.stage === "claim").metadata.selected[0].articleId,
    newer,
  );
  const isolated = await app.inject({
    url: `/api/workspaces/${other}/query/traces/${trace}`,
    headers,
  });
  assert.deepEqual(isolated.json().events, []);
  assert.equal(
    (
      await app.inject({
        url: `/api/workspaces/${other}/query/claims/${newer}?revision=1&anchor=provider`,
        headers,
      })
    ).statusCode,
    404,
  );
});
test("no match and unprocessed input are different; lookup never changes curation or creates publications", async () => {
  const before = (
    await read("SELECT config FROM ai_settings WHERE workspace_id=$1", [ws])
  ).rows;
  const count = (
    await read("SELECT count(*) FROM publications WHERE workspace_id=$1", [ws])
  ).rows[0].count;
  assert.equal((await api("/query?q=nonexistent")).json().status, "not_found");
  await read(
    "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
    [randomUUID(), ws, sourceId],
  );
  assert.equal(
    (await api("/query?q=nonexistent")).json().status,
    "not_found_with_unprocessed_inputs",
  );
  assert.deepEqual(
    (await read("SELECT config FROM ai_settings WHERE workspace_id=$1", [ws]))
      .rows,
    before,
  );
  assert.equal(
    (
      await read("SELECT count(*) FROM publications WHERE workspace_id=$1", [
        ws,
      ])
    ).rows[0].count,
    count,
  );
});
test("bounded trace, explicit pinned claim, source ranges and missing evidence fail closed", async () => {
  assert.equal(
    (await api("/query/claims/" + newer + "?anchor=provider")).statusCode,
    400,
  );
  assert.equal(
    (await api(`/query/claims/${newer}?revision=1&anchor=missing`)).statusCode,
    404,
  );
  assert.equal(
    (await api(`/query/sources/${sourceId}?start=1&end=81`)).statusCode,
    400,
  );
  const trace = randomUUID();
  for (let i = 0; i < 12; i++)
    assert.equal(
      (await api("/query?q=nonexistent&traceId=" + trace)).statusCode,
      200,
    );
  const over = await api("/query?q=nonexistent&traceId=" + trace);
  assert.equal(over.statusCode, 429);
  assert.equal(over.json().error, "QUERY_BUDGET_EXHAUSTED");
  await read(
    "UPDATE sources SET deleted_at=now() WHERE workspace_id=$1 AND id=$2",
    [ws, sourceId],
  );
  assert.equal(
    (await api(`/query/sources/${sourceId}?start=2&end=2`)).statusCode,
    404,
  );
  const claim = (
    await api(`/query/claims/${newer}?revision=1&anchor=provider`)
  ).json();
  assert.equal(claim.claim.evidence[0].unavailable, true);
});
