import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
import { pool, tx } from "../packages/core/src/db.js";
import { hash } from "../packages/core/src/storage.js";
import {
  effectiveClaimState,
  storeClaimRelations,
} from "../apps/agent-wiki-api/src/claim-relations.js";
import { republishChange } from "../apps/agent-wiki-api/src/claim-relation-reject.js";
import { conflictsReview } from "../apps/agent-wiki-api/src/review-conflicts.js";
// Covers the four new manual-authoring commands (docs stay in AGENTS.md /
// l2-l3-memory.md, out of scope here): `claim retire`, `claim assert`,
// `relation add` and `review conflicts`, plus the FEEDBACK_REQUIRES_HUMAN
// guard. Every command is a thin CLI wrapper over these same HTTP endpoints
// (source-records + publications + claim-relations/add), so exercising the
// endpoints proves the CLI mechanism works end to end.
const owner = "claim-authoring-" + randomUUID(),
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
    payload: { name: "Claim authoring" },
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
// Registers a note source exactly the way `claim retire`/`claim assert` do:
// POST /source-records with kind=note, origin=feedback:<login>.
async function registerNote(text: string, origin = "feedback:" + owner) {
  const r = await call("POST", "/source-records", {
    name: "테스트 근거",
    kind: "note",
    origin,
    text,
  });
  assert.equal(r.statusCode, 200, r.body);
  const s = r.json();
  return {
    evidence: [
      {
        sourceId: s.id as string,
        revision: 1 as const,
        lines: [1, s.lineCount] as [number, number],
        quote: s.text as string,
      },
    ],
    text: s.text as string,
  };
}
async function publishOne(payload: any) {
  const r = await call("POST", "/publications", payload);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().items[0] as { id: string; revision: number };
}
function article(claim: any, opts: { topic?: any; claimRelations?: any[] } = {}) {
  return {
    idempotencyKey: randomUUID(),
    producer: { type: "agent", client: "agent-wiki-cli" },
    reason: claim.text,
    changes: [
      {
        clientRef: "a",
        kind: "memory",
        title: claim.text.slice(0, 60),
        content: claim.text,
        ...(opts.topic ? { topic: opts.topic } : {}),
        claims: [claim],
        claimRelations: opts.claimRelations ?? [],
      },
    ],
  };
}
async function detail(id: string) {
  const r = await call("GET", "/articles/" + id);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
function claimByAnchor(d: any, anchor: string) {
  return d.claims.find((c: any) => c.anchor === anchor);
}

test("claim retire: registers a feedback note, publishes a user_decision claim citing it, and retracts the target", async () => {
  const note0 = await registerNote("target seed");
  const target = await publishOne(
    article(
      {
        anchor: "decision",
        text: "백업은 A안을 쓴다.",
        type: "user_decision",
        subject: "backup-approach",
        scope: "production",
        state: "current",
        evidence: note0.evidence,
      },
      { topic: { key: "backup-topic", title: "백업" } },
    ),
  );
  const note = await registerNote(
    "A안은 잘못된 결정이었다. 되돌린다.",
  );
  const retire = await publishOne(
    article(
      {
        anchor: "decision",
        text: note.text,
        type: "user_decision",
        subject: "backup-approach",
        scope: "production",
        state: "current",
        evidence: note.evidence,
      },
      {
        topic: { key: "backup-topic", title: "백업" },
        claimRelations: [
          {
            anchor: "decision",
            relation: "retracts",
            target: { articleId: target.id, revision: target.revision, anchor: "decision" },
            evidence: note.evidence,
          },
        ],
      },
    ),
  );
  const targetDetail = await detail(target.id);
  assert.equal(claimByAnchor(targetDetail, "decision").state, "retracted");
  const retireDetail = await detail(retire.id);
  const retireClaim = claimByAnchor(retireDetail, "decision");
  assert.equal(retireClaim.state, "current");
  assert.equal(retireClaim.type, "user_decision");
  assert.ok(
    retireClaim.evidence.length >= 1,
    "the retire claim itself keeps at least one evidence row",
  );
  assert.equal(retireClaim.evidence[0].origin, "feedback:" + owner);
  // Published without the target's topic the correction lands on topic_key='',
  // which no wiki page assembles and no consolidation gathers — the user's fix
  // is then invisible exactly where the claim it replaces is read. The CLI
  // reads topic_key off the target article for this reason.
  assert.equal(targetDetail.topic_key, "backup-topic");
  assert.equal(
    retireDetail.topic_key,
    targetDetail.topic_key,
    "the correction carries the target's topic",
  );
});

test("claim assert without --supersedes creates a standalone current claim under a topic, grounded in evidence", async () => {
  const note = await registerNote("이 프로젝트는 앞으로 pnpm을 쓴다.");
  const created = await publishOne(
    article(
      {
        anchor: "decision",
        text: note.text,
        type: "user_decision",
        subject: "package-manager",
        scope: "general",
        state: "current",
        evidence: note.evidence,
      },
      { topic: { key: "tooling-assert-topic", title: "tooling-assert-topic" } },
    ),
  );
  const d = await detail(created.id);
  assert.equal(d.topic_key, "tooling-assert-topic");
  const claim = claimByAnchor(d, "decision");
  assert.equal(claim.state, "current");
  assert.equal(claim.subject, "package-manager");
  assert.ok(claim.evidence.length >= 1, "asserted claim has evidence");
});

test("claim assert with --supersedes replaces the prior claim", async () => {
  const note0 = await registerNote("과거 결정 근거");
  const prior = await publishOne(
    article({
      anchor: "decision",
      text: "패키지 매니저는 npm을 쓴다.",
      type: "user_decision",
      subject: "package-manager-2",
      scope: "general",
      state: "current",
      evidence: note0.evidence,
    }),
  );
  const note = await registerNote("생각이 바뀌었다. pnpm으로 바꾼다.");
  await publishOne(
    article(
      {
        anchor: "decision",
        text: note.text,
        type: "user_decision",
        subject: "package-manager-2",
        scope: "general",
        state: "current",
        evidence: note.evidence,
      },
      {
        topic: { key: "tooling-supersede-topic", title: "tooling-supersede-topic" },
        claimRelations: [
          {
            anchor: "decision",
            relation: "supersedes",
            target: { articleId: prior.id, revision: prior.revision, anchor: "decision" },
            evidence: note.evidence,
          },
        ],
      },
    ),
  );
  const priorDetail = await detail(prior.id);
  assert.equal(claimByAnchor(priorDetail, "decision").state, "superseded");
});

test("relation add publishes a corrective Version of FROM and stores the relation", async () => {
  const noteA = await registerNote("근거 A");
  const a = await publishOne(
    article({
      anchor: "decision",
      text: "인프라는 X 방식을 쓴다.",
      type: "user_decision",
      subject: "infra-relation-add",
      scope: "production",
      state: "current",
      evidence: noteA.evidence,
    }),
  );
  const noteB = await registerNote("근거 B");
  const b = await publishOne(
    article({
      anchor: "decision",
      text: "인프라는 Y 방식을 쓴다.",
      type: "user_decision",
      subject: "infra-relation-add",
      scope: "production",
      state: "current",
      evidence: noteB.evidence,
    }),
  );
  // Nothing proposed a relation between a and b yet; both are still current.
  const beforeA = await detail(a.id);
  assert.equal(claimByAnchor(beforeA, "decision").state, "current");
  // A claim cannot stand in any relation to itself. Nothing rejected this, and
  // a self-supersedes passed every other gate and then made
  // effectiveClaimState retire the claim on its own authority.
  const self = await call("POST", "/claim-relations/add", {
    from: { articleId: a.id, revision: 1, anchor: "decision" },
    to: { articleId: a.id, revision: 1, anchor: "decision" },
    relation: "supersedes",
    client: "claude",
    reason: "테스트: 자기 자신을 대체할 수는 없다",
  });
  assert.equal(self.statusCode, 400, self.body);
  assert.equal(self.json().error, "CLAIM_RELATION_SELF");
  const added = await call("POST", "/claim-relations/add", {
    from: { articleId: b.id, revision: 1, anchor: "decision" },
    to: { articleId: a.id, revision: 1, anchor: "decision" },
    relation: "supersedes",
    client: "claude",
    reason: "테스트: 사용자가 직접 관계를 추가한다",
  });
  assert.equal(added.statusCode, 200, added.body);
  assert.equal(added.json().ok, true);
  assert.ok(added.json().publicationId);
  const bAfter = (
    await admin.query(
      "SELECT revision FROM articles WHERE workspace_id=$1 AND id=$2",
      [ws, b.id],
    )
  ).rows[0];
  assert.equal(bAfter.revision, 2, "FROM got a corrective Version");
  const aDetail = await detail(a.id);
  assert.equal(claimByAnchor(aDetail, "decision").state, "superseded");
});

test("relation add reports an existing gate's code clearly instead of writing anything", async () => {
  const note1 = await registerNote("scope 1 근거");
  const c1 = await publishOne(
    article({
      anchor: "decision",
      text: "범위가 다른 주장 1",
      type: "user_decision",
      subject: "scope-mismatch-subject",
      scope: "production",
      state: "current",
      evidence: note1.evidence,
    }),
  );
  const note2 = await registerNote("scope 2 근거");
  const c2 = await publishOne(
    article({
      anchor: "decision",
      text: "범위가 다른 주장 2",
      type: "user_decision",
      subject: "scope-mismatch-subject",
      scope: "local",
      state: "current",
      evidence: note2.evidence,
    }),
  );
  const rejected = await call("POST", "/claim-relations/add", {
    from: { articleId: c2.id, revision: 1, anchor: "decision" },
    to: { articleId: c1.id, revision: 1, anchor: "decision" },
    relation: "supports",
    client: "claude",
    reason: "scope가 다른데 관계를 걸어본다",
  });
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal(rejected.json().error, "CLAIM_SCOPE_MISMATCH");
});

test("FEEDBACK_REQUIRES_HUMAN: an automatic producer may not supersede a user's feedback-sourced claim, but a user-initiated one may", async () => {
  const feedbackNote = await registerNote("사용자가 직접 고친 결정");
  const target = await publishOne(
    article({
      anchor: "decision",
      text: feedbackNote.text,
      type: "user_decision",
      subject: "feedback-guard-subject",
      scope: "production",
      state: "current",
      evidence: feedbackNote.evidence,
    }),
  );
  const noteA = await registerNote("자동 재정의 시도 근거", "test-" + randomUUID());
  const fromA = await publishOne(
    article({
      anchor: "decision",
      text: "자동으로 되돌리려는 시도",
      type: "user_decision",
      subject: "feedback-guard-subject",
      scope: "production",
      state: "current",
      evidence: noteA.evidence,
    }),
  );
  await assert.rejects(
    tx(owner, ws, (c) =>
      storeClaimRelations(
        c,
        ws,
        fromA.id,
        1,
        randomUUID(),
        [
          {
            anchor: "decision",
            relation: "supersedes",
            target: { articleId: target.id, revision: target.revision, anchor: "decision" },
            evidence: noteA.evidence,
          },
        ],
        new Set(),
        false,
        true, // dryRun: never reaches the INSERT even if the guard were absent
        true, // automaticProducer
      ),
    ),
    (e: any) => e.code === "FEEDBACK_REQUIRES_HUMAN",
  );
  // Nothing was written by the blocked attempt: target is still current.
  const stillCurrent = await detail(target.id);
  assert.equal(claimByAnchor(stillCurrent, "decision").state, "current");
  const noteB = await registerNote("사용자가 직접 되돌린다", "test-" + randomUUID());
  const fromB = await publishOne(
    article({
      anchor: "decision",
      text: "사용자 본인이 되돌리는 시도",
      type: "user_decision",
      subject: "feedback-guard-subject",
      scope: "production",
      state: "current",
      evidence: noteB.evidence,
    }),
  );
  const pubId = randomUUID();
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [
        pubId,
        ws,
        "test-guard-pub-" + pubId,
        "hash",
        JSON.stringify({ type: "agent", client: "test" }),
        "",
      ],
    ),
  );
  await tx(owner, ws, (c) =>
    storeClaimRelations(
      c,
      ws,
      fromB.id,
      1,
      pubId,
      [
        {
          anchor: "decision",
          relation: "supersedes",
          target: { articleId: target.id, revision: target.revision, anchor: "decision" },
          evidence: noteB.evidence,
        },
      ],
      new Set(),
      false,
      false,
      false, // automaticProducer: false -> user-initiated, allowed
    ),
  );
  const nowSuperseded = await detail(target.id);
  assert.equal(claimByAnchor(nowSuperseded, "decision").state, "superseded");
});

test("review conflicts lists a live contradicts pair with evidence times, pending inbox rows and leaveUnresolved reasons", async () => {
  const topicKey = "review-conflicts-topic";
  const noteX = await registerNote("충돌 X", "test-" + randomUUID());
  const x = await publishOne(
    article(
      {
        anchor: "decision",
        text: "백업은 A안이다.",
        type: "observation",
        subject: "conflict-subject",
        scope: "production",
        state: "current",
        evidence: noteX.evidence,
      },
      { topic: { key: topicKey, title: topicKey } },
    ),
  );
  const noteY = await registerNote("충돌 Y", "test-" + randomUUID());
  const y = await publishOne(
    article(
      {
        anchor: "decision",
        text: "백업은 B안이다.",
        type: "observation",
        subject: "conflict-subject",
        scope: "production",
        state: "current",
        evidence: noteY.evidence,
      },
      {
        topic: { key: topicKey, title: topicKey },
        claimRelations: [
          {
            anchor: "decision",
            relation: "contradicts",
            target: { articleId: x.id, revision: x.revision, anchor: "decision" },
            evidence: noteY.evidence,
          },
        ],
      },
    ),
  );
  const inboxId = randomUUID();
  await tx(owner, ws, (c) =>
    c.query(
      `INSERT INTO consolidation_inbox(workspace_id,id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation,evidence,error_code,status)
       VALUES($1,$2,$3,1,'decision',$4,1,'decision','supersedes','[]'::jsonb,'CLAIM_TARGET_VERSION_CHANGED','pending')`,
      [ws, inboxId, x.id, y.id],
    ),
  );
  const jobId = randomUUID();
  await tx(owner, ws, (c) =>
    c.query(
      `INSERT INTO consolidation_jobs(workspace_id,id,topic_key,status,trigger,steps)
       VALUES($1,$2,$3,'completed','manual',$4::jsonb)`,
      [
        ws,
        jobId,
        topicKey,
        JSON.stringify({
          gather: { status: "done", attempts: 1 },
          model: {
            status: "done",
            attempts: 1,
            output: {
              relations: [],
              leaveUnresolved: [
                { subject: "conflict-subject", scope: "production", reason: "결론 불명확" },
              ],
            },
          },
          validate: { status: "skipped", attempts: 0 },
          publish: { status: "skipped", attempts: 0 },
        }),
      ],
    ),
  );
  const result = await tx(owner, ws, (c) => conflictsReview(c, ws, topicKey));
  assert.equal(result.conflicts.length, 1);
  const conflict = result.conflicts[0];
  assert.equal(conflict.subject, "conflict-subject");
  assert.equal(conflict.scope, "production");
  assert.equal(conflict.from.state, "conflicted");
  assert.equal(conflict.to.state, "conflicted");
  assert.ok(Array.isArray(conflict.from.evidenceTimes));
  assert.ok(Array.isArray(conflict.to.evidenceTimes));
  assert.ok(
    result.inbox.some((row: any) => row.id === inboxId),
    JSON.stringify(result.inbox),
  );
  assert.ok(
    result.leaveUnresolved.some(
      (job: any) =>
        job.jobId === jobId &&
        job.reasons.some((r: any) => r.reason === "결론 불명확"),
    ),
    JSON.stringify(result.leaveUnresolved),
  );
  // Read-only: this call must never create a Job of its own.
  const jobsAfter = (
    await admin.query(
      "SELECT count(*)::int AS n FROM consolidation_jobs WHERE workspace_id=$1",
      [ws],
    )
  ).rows[0].n;
  assert.equal(jobsAfter, 1);
  // Also reachable over HTTP, as the CLI uses it.
  const httpResult = await call(
    "GET",
    "/review/conflicts?topic=" + encodeURIComponent(topicKey),
  );
  assert.equal(httpResult.statusCode, 200, httpResult.body);
  assert.equal(httpResult.json().conflicts.length, 1);
});

// A contradiction is open only while both ends are live. Retiring one end used
// to leave the survivor flagged conflicted forever, so `review conflicts` never
// emptied. Found by resolving a real conflict in production with `claim retire`.
test("retiring one end of a contradiction settles it; the survivor leaves the conflict queue", async () => {
  const article = randomUUID(),
    pub = randomUUID(),
    src = randomUUID();
  await admin.query(
    `INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked)
     VALUES($1,$2,'settle','note','synthetic','h','p','k',1,$3,true)`,
    [src, ws, src],
  );
  await admin.query(
    `INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason)
     VALUES($1,$2,$3,'h','{"type":"agent","client":"synthetic"}','settle')`,
    [pub, ws, pub],
  );
  await admin.query(
    "INSERT INTO articles(id,workspace_id,title,content,kind,revision,topic_key) VALUES($1,$2,'설정','본문','memory',1,'settle-topic')",
    [article, ws],
  );
  await admin.query(
    "INSERT INTO revisions(workspace_id,article_id,revision,title,content,metadata,publication_id) VALUES($1,$2,1,'설정','본문','{}',$3)",
    [ws, article, pub],
  );
  for (const [anchor, text] of [
    ["settle-a", "백업을 매일 1회 수행한다"],
    ["settle-b", "백업은 후속 과제로 미룬다"],
  ])
    await admin.query(
      "INSERT INTO claims(workspace_id,article_id,revision,anchor,text,type,subject,scope,state) VALUES($1,$2,1,$3,$4,'user_decision','backup-policy','general','current')",
      [ws, article, anchor, text],
    );
  const relate = (from: string, to: string, relation: string) =>
    admin.query(
      `INSERT INTO claim_relations(workspace_id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation,evidence,publication_id)
       VALUES($1,$2,1,$3,$2,1,$4,$5,'[]',$6)`,
      [ws, article, from, to, relation, pub],
    );
  const stateOf = async (anchor: string) =>
    (
      await admin.query(
        `SELECT ${effectiveClaimState("cl")} AS s FROM claims cl WHERE cl.workspace_id=$1 AND cl.article_id=$2 AND cl.anchor=$3`,
        [ws, article, anchor],
      )
    ).rows[0].s;
  await relate("settle-a", "settle-b", "contradicts");
  assert.equal(await stateOf("settle-a"), "conflicted");
  assert.equal(await stateOf("settle-b"), "conflicted");
  await relate("settle-b", "settle-a", "retracts");
  assert.equal(
    await stateOf("settle-a"),
    "retracted",
    "the retired end is retracted, not conflicted",
  );
  assert.equal(
    await stateOf("settle-b"),
    "current",
    "the survivor is no longer flagged by a settled contradiction",
  );
});

// A corrective Version copied each claim's stored state. Relations point at a
// fixed (article, revision, anchor) and are not carried forward, so a sibling
// that a relation had superseded came back as current on the new Version —
// relation add or reject would silently resurrect what was already retired.
test("republishChange carries effective state, not the stored column", async () => {
  const article = randomUUID(),
    pub = randomUUID(),
    src = randomUUID();
  await admin.query(
    `INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked)
     VALUES($1,$2,'resurrect','note','synthetic','h','p','k',1,$3,true)`,
    [src, ws, src],
  );
  await admin.query(
    `INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason)
     VALUES($1,$2,$3,'h','{"type":"agent","client":"synthetic"}','seed')`,
    [pub, ws, pub],
  );
  await admin.query(
    "INSERT INTO articles(id,workspace_id,title,content,kind,revision,topic_key) VALUES($1,$2,'되살아남','본문','memory',1,'resurrect-topic')",
    [article, ws],
  );
  await admin.query(
    "INSERT INTO revisions(workspace_id,article_id,revision,title,content,metadata,publication_id) VALUES($1,$2,1,'되살아남','본문','{}',$3)",
    [ws, article, pub],
  );
  for (const anchor of ["keep", "sibling", "newer"])
    await admin.query(
      "INSERT INTO claims(workspace_id,article_id,revision,anchor,text,type,subject,scope,state) VALUES($1,$2,1,$3,$3,'user_decision','resurrect-check','production','current')",
      [ws, article, anchor],
    );
  await admin.query(
    `INSERT INTO claim_relations(workspace_id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation,evidence,publication_id)
     VALUES($1,$2,1,'newer',$2,1,'sibling','supersedes','[]',$3)`,
    [ws, article, pub],
  );
  const change = await tx(owner, ws, (c) => republishChange(c, ws, article));
  const stateOf = (anchor: string) =>
    change.claims.find((cl: any) => cl.anchor === anchor)?.state;
  assert.equal(
    stateOf("sibling"),
    "superseded",
    "a superseded sibling must not come back as current on the new Version",
  );
  assert.equal(stateOf("keep"), "current");
  assert.equal(stateOf("newer"), "current");
});
