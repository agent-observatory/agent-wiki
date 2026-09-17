import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
import { pool } from "../packages/core/src/db.js";
import { hash } from "../packages/core/src/storage.js";
const owner = "claims-" + randomUUID(),
  token = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const headers = {
  cookie: "wiki_session=" + token,
  origin: "http://localhost:3000",
};
let app: Awaited<ReturnType<typeof buildApp>>, ws: string;
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  app = await buildApp();
  await app.ready();
  const r = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    headers,
    payload: { name: "Claim experiment" },
  });
  ws = r.json().id;
});
after(async () => {
  await app?.close();
  await pool.end();
  await admin.end();
});
async function call(method: "GET" | "POST", path: string, payload?: any) {
  return app.inject({
    method,
    url: "/api/workspaces/" + ws + path,
    headers:
      method === "POST"
        ? { ...headers, "idempotency-key": randomUUID() }
        : headers,
    payload,
  });
}
async function proposal(text: string, opts: any = {}) {
  const s = await call("POST", "/source-records", {
    name: "Synthetic",
    text,
    kind: "note",
    origin: "test-" + randomUUID(),
  });
  assert.equal(s.statusCode, 200, s.body);
  const evidence = {
    sourceId: s.json().id,
    revision: 1,
    lines: [1, 1],
    quote: text,
  };
  return {
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes: [
      {
        clientRef: "decision",
        title: text,
        content: text,
        tags: ["experiment"],
        claims: [
          {
            anchor: "decision",
            text,
            type: "user_decision",
            subject: "database",
            scope: "production",
            state: "current",
            evidence: [evidence],
            ...opts,
          },
        ],
        claimRelations: [] as any[],
      },
    ],
  };
}
async function publish(p: any) {
  const r = await call("POST", "/publications", p);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().items[0].id as string;
}
function relate(p: any, id: string, relation = "supersedes") {
  p.changes[0].claimRelations = [
    {
      anchor: "decision",
      relation,
      target: { articleId: id, revision: 1, anchor: "decision" },
      evidence: structuredClone(p.changes[0].claims[0].evidence),
    },
  ];
}
test("current query follows explicit replacement; history retains evidence and immutable L1", async () => {
  const a = await proposal("Supabase를 운영 DB로 채택한다.");
  const old = await publish(a);
  const b = await proposal(
    "기존 선택을 취소하고 OCI PostgreSQL을 운영 DB로 채택한다.",
  );
  relate(b, old);
  const current = await publish(b);
  assert.equal(await publish(b), current, "idempotent retry");
  const stale = await proposal("현재 결정을 못 본 오래된 대상 변경");
  relate(stale, old);
  assert.equal(
    (await call("POST", "/publications", stale)).json().error,
    "CLAIM_TARGET_ALREADY_RETIRED",
  );
  const d = (await call("GET", "/articles/" + old)).json();
  assert.equal(d.claims[0].state, "superseded");
  assert.equal(d.content, a.changes[0].content);
  const result = (
    await call("GET", "/context?q=Supabase&tag=experiment")
  ).json();
  assert.ok(
    result.citations.some((c: any) => c.id === current),
    JSON.stringify(result),
  );
  assert.ok(!result.citations.some((c: any) => c.id === old));
  const history = (
    await call("GET", "/context?q=Supabase&tag=experiment&view=history")
  ).json();
  assert.ok(
    history.citations.some(
      (c: any) => c.id === old && c.claims[0].state === "superseded",
    ),
  );
  assert.ok(
    history.citations.some((c: any) =>
      c.claimRelations.some(
        (r: any) => r.target.articleId === old && r.target.revision === 1,
      ),
    ),
  );
  const sourceId = a.changes[0].claims[0].evidence[0].sourceId;
  assert.equal(
    (await call("GET", `/source-records/${sourceId}/revisions/1`)).json().text,
    a.changes[0].content,
  );
});
test("one publication preserves a four-decision provider lineage and defaults to the final decision", async () => {
  const phrases = [
    "09:00 정제 Provider는 NVIDIA를 채택한다.",
    "10:00 NVIDIA 호출 지연 때문에 Alibaba로 Provider를 변경한다.",
    "11:00 검증을 위해 Alibaba에서 ExampleCloud로 변경한다.",
    "12:00 검증을 마쳐 ExampleCloud 대신 Alibaba Singapore로 돌아간다.",
  ];
  const changes = [];
  for (let i = 0; i < phrases.length; i++) {
    const p = await proposal(phrases[i], {
      subject: "ai-provider",
      scope: "general",
    });
    const change = p.changes[0];
    change.clientRef = "provider-" + i;
    change.tags = ["provider-lineage"];
    if (i)
      change.claimRelations = [
        {
          anchor: "decision",
          relation: "supersedes",
          target: { clientRef: "provider-" + (i - 1), anchor: "decision" },
          evidence: change.claims[0].evidence,
        },
      ];
    changes.push(change);
  }
  const payload = {
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "synthetic" },
    changes,
  };
  const response = await call("POST", "/publications", payload);
  assert.equal(response.statusCode, 200, response.body);
  const items = response.json().items;
  assert.deepEqual(
    (await call("POST", "/publications", payload)).json(),
    response.json(),
  );
  const now = (
    await call("GET", "/context?q=NVIDIA&tag=provider-lineage")
  ).json();
  assert.ok(
    now.citations.some((item: any) => item.id === items[3].id),
    JSON.stringify(now),
  );
  assert.ok(
    !now.citations.some((item: any) =>
      item.claims.some((claim: any) => claim.state === "superseded"),
    ),
  );
  const history = (
    await call("GET", "/context?q=NVIDIA&tag=provider-lineage&view=history")
  ).json();
  assert.equal(new Set(history.citations.map((item: any) => item.id)).size, 4);
  for (let i = 0; i < items.length; i++) {
    const article = (await call("GET", "/articles/" + items[i].id)).json();
    assert.equal(article.claims[0].state, i === 3 ? "current" : "superseded");
    assert.equal(article.content, phrases[i]);
    assert.equal(article.claims[0].evidence[0].quote, phrases[i]);
  }
});
test("local decision references reject forward links, missing targets and self cycles atomically", async () => {
  for (const target of ["later", "missing", "first"]) {
    const first = (
      await proposal("합성 이전 결정", {
        subject: "provider",
        scope: "general",
      })
    ).changes[0];
    first.clientRef = "first";
    first.claimRelations = [
      {
        anchor: "decision",
        relation: "supersedes",
        target: { clientRef: target, anchor: "decision" },
        evidence: first.claims[0].evidence,
      },
    ];
    const later = (
      await proposal("합성 다음 결정", {
        subject: "provider",
        scope: "general",
      })
    ).changes[0];
    later.clientRef = "later";
    const key = randomUUID();
    const response = await call("POST", "/publications", {
      idempotencyKey: key,
      producer: { type: "agent", client: "synthetic" },
      changes: [first, later],
    });
    assert.equal(response.json().error, "CLAIM_LOCAL_TARGET_NOT_PRIOR");
    const rows = await admin.query(
      "SELECT id FROM publications WHERE workspace_id=$1 AND idempotency_key=$2",
      [ws, key],
    );
    assert.equal(
      rows.rowCount,
      0,
      "invalid graph rolls back the whole publication",
    );
  }
});
test("proposals, scopes, authority and unsupported relation evidence cannot retire a decision", async () => {
  const old = await publish(await proposal("검증용 기존 결정"));
  for (const [opts, code] of [
    [{ state: "proposed" }, "CLAIM_REPLACEMENT_NOT_CURRENT"],
    [{ scope: "local" }, "CLAIM_SCOPE_MISMATCH"],
    [{ type: "ai_inference" }, "DECISION_AUTHORITY_MISMATCH"],
  ] as const) {
    const p = await proposal("새 검토 의견", opts);
    relate(p, old);
    const r = await call("POST", "/publications", p);
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().error, code);
  }
  const invalid = await proposal("근거 없는 연결");
  relate(invalid, old);
  invalid.changes[0].claimRelations[0].evidence[0] = {
    ...invalid.changes[0].claimRelations[0].evidence[0],
    quote: "not provided",
  };
  assert.equal(
    (await call("POST", "/publications", invalid)).json().error,
    "CLAIM_RELATION_EVIDENCE_REQUIRED",
  );
  assert.equal(
    (await call("GET", "/articles/" + old)).json().claims[0].state,
    "current",
  );
  const proposed = await publish(
    await proposal("대안도 좋을까?", { state: "proposed" }),
  );
  assert.equal(
    (await call("GET", "/articles/" + proposed)).json().claims[0].state,
    "proposed",
  );
});
test("unresolved conflicts expose both sides and do not silently choose the newer statement", async () => {
  const old = await publish(await proposal("ConflictAlpha 사용"));
  const p = await proposal("ConflictBeta 사용");
  relate(p, old, "contradicts");
  const newer = await publish(p);
  for (const id of [old, newer])
    assert.equal(
      (await call("GET", "/articles/" + id)).json().claims[0].state,
      "conflicted",
    );
  const result = (
    await call("GET", "/context?q=ConflictAlpha&scope=production")
  ).json();
  assert.ok(
    result.citations.some(
      (c: any) => c.id === old && c.excerpt.includes("[미해결 충돌]"),
    ),
  );
  assert.ok(result.citations.some((c: any) => c.id === newer));
  const local = (
    await call("GET", "/context?q=ConflictAlpha&scope=local")
  ).json();
  assert.equal(local.citations.length, 0);
});

test("history follows fixed revisions even when the replacement is another version of the same article", async () => {
  const first = await proposal("VersionExample 이전 결정");
  const id = await publish(first);
  const next: any = await proposal("VersionExample 새로운 결정");
  next.changes[0].articleId = id;
  next.changes[0].baseRevision = 1;
  relate(next, id);
  await publish(next);
  const history = (
    await call("GET", "/context?q=VersionExample&view=history")
  ).json();
  assert.ok(
    history.citations.some(
      (c: any) =>
        c.id === id && c.revision === 1 && c.excerpt.includes("이전 결정"),
    ),
    JSON.stringify(history),
  );
  assert.ok(
    history.citations.some(
      (c: any) =>
        c.id === id && c.revision === 2 && c.excerpt.includes("새로운 결정"),
    ),
  );
  const invalid: any = await proposal("VersionExample 잘못된 자기 참조");
  invalid.changes[0].articleId = id;
  invalid.changes[0].baseRevision = 2;
  relate(invalid, id);
  invalid.changes[0].claimRelations[0].target.revision = 3;
  // The fixture's own name for this is "잘못된 자기 참조": the claim points at
  // itself. CLAIM_RELATION_SELF names that directly, where CLAIM_TARGET_NOT_PRIOR
  // only said the target was not an earlier change.
  assert.equal(
    (await call("POST", "/publications", invalid)).json().error,
    "CLAIM_RELATION_SELF",
  );
});

test("query distinguishes processed knowledge from pending curation", async () => {
  const p = await proposal("아직 반영하지 않은 새로운 결정");
  const source = p.changes[0].claims[0].evidence[0].sourceId;
  await admin.query(
    "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
    [randomUUID(), ws, source],
  );
  const result = (await call("GET", "/context?q=VersionExample")).json();
  assert.equal(result.curation.hasUnprocessedInputs, true);
  assert.equal(result.curation.pending, 1);
  assert.ok(result.notice.includes("최신 결정이 미반영"));
});
test("a jobless conversation-kind source counts as unprocessed for recall and query, but a jobless source-record does not", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    headers,
    payload: { name: "Jobless coverage" },
  });
  const freshWs = created.json().id as string;
  const freshCall = (path: string) =>
    app.inject({
      method: "GET",
      url: "/api/workspaces/" + freshWs + path,
      headers,
    });
  // A source-record (kind<>'conversation') never gets a refinement_jobs row
  // by design; being jobless must not flip hasUnprocessedInputs.
  const noteSource = randomUUID();
  await admin.query(
    "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'note','note','',$1::text,$1::text,'unused',1,$1::text,true)",
    [noteSource, freshWs],
  );
  assert.equal(
    (await freshCall("/context?q=nonexistent")).json().curation
      .hasUnprocessedInputs,
    false,
    "a jobless source-record is not counted",
  );
  assert.equal(
    (await freshCall("/query?q=nonexistent&view=overview")).json().status,
    "not_found",
    "the query API agrees",
  );
  // A scoped curation rebuild (curation-rebuild.ts) deletes a conversation-
  // kind source's job row while keeping the source: it must be honestly
  // reported as unprocessed, not silently treated as fully curated.
  const conversationSource = randomUUID();
  await admin.query(
    "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'jobless','conversation','codex:jobless',$1::text,$1::text,'unused',1,$1::text,true)",
    [conversationSource, freshWs],
  );
  const recall = (await freshCall("/context?q=nonexistent")).json();
  assert.equal(
    recall.curation.hasUnprocessedInputs,
    true,
    "a jobless conversation-kind source is honestly reported as unprocessed",
  );
  const overview = (await freshCall("/query?q=nonexistent&view=overview")).json();
  assert.equal(overview.status, "not_found_with_unprocessed_inputs");
  assert.equal(overview.hasUnprocessedInputs, true);
});



// Consolidation only compares claims that share subject and scope, so one
// property under two slugs was never compared at all. A person joins the two
// here; the claims keep the slug they were published with.
test("a subject alias lets two split slugs relate, and chains are refused", async () => {
  const old = await publish(await proposal("이전 저장소 결정", { subject: "graph-storage-visualization" }));
  const next: any = await proposal("새 저장소 결정", {
    subject: "graph-storage-and-visualization",
  });
  relate(next, old);
  assert.equal(
    (await call("POST", "/publications", next)).json().error,
    "CLAIM_SCOPE_MISMATCH",
    "split slugs cannot relate before anyone says they are the same",
  );
  const added = await call("POST", "/subject-aliases", {
    alias: "graph-storage-and-visualization",
    canonical: "graph-storage-visualization",
    reason: "테스트: 불용어만 다른 같은 속성",
  });
  assert.equal(added.statusCode, 200, added.body);
  const joined: any = await proposal("별칭 확정 뒤의 새 결정", {
    subject: "graph-storage-and-visualization",
  });
  relate(joined, old);
  const ok = await call("POST", "/publications", joined);
  assert.equal(ok.statusCode, 200, ok.body);
  // A chain would make the answer depend on how many times canonical() runs.
  const chain = await call("POST", "/subject-aliases", {
    alias: "graph-storage-visualization",
    canonical: "something-else",
    reason: "테스트: 사슬",
  });
  assert.equal(chain.statusCode, 400, chain.body);
  assert.equal(chain.json().error, "SUBJECT_ALIAS_IS_CANONICAL");
  const reverse = await call("POST", "/subject-aliases", {
    alias: "yet-another",
    canonical: "graph-storage-and-visualization",
    reason: "테스트: 반대 방향 사슬",
  });
  assert.equal(reverse.json().error, "SUBJECT_ALIAS_CHAIN");
  const removed = await call("POST", "/subject-aliases/remove", {
    alias: "graph-storage-and-visualization",
  });
  assert.equal(removed.statusCode, 200, removed.body);
});
