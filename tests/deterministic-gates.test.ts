import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, putSource } from "../packages/core/src/storage.js";
import { publish } from "../apps/agent-wiki-api/src/knowledge.js";
// Two deterministic gates added alongside the existing claim-level checks:
// DECISION_EVIDENCE_NOT_USER (a user_decision needs user-authored evidence,
// when role data is available at all — apps/agent-wiki-api/src/knowledge-
// publish.ts) and SUPERSEDES_BACKWARD_IN_TIME (a replacement cannot predate
// what it replaces, using only trustworthy 'recorded' times —
// storeClaimRelations in apps/agent-wiki-api/src/claim-relations.ts).
// docs/l2-l3-memory.md.
const owner = "deterministic-gates-" + randomUUID(),
  ws = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,'Deterministic gates')",
    [ws, owner],
  );
});
after(async () => {
  await pool.end();
  await admin.end();
});
// Records the raw JSON lines: evidence quotes the exact source line, not the
// decoded field value inside it.
async function source(lines: string[]) {
  const text = lines.join("\n"),
    id = randomUUID(),
    key = ws + "/" + hash(text) + ".txt.gz";
  await putSource(key, text);
  await tx(owner, ws, (c) =>
    c.query(
      "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'test','conversation','synthetic',$3,$3,$4,$5,$1::text,true)",
      [id, ws, hash(text), key, lines.length],
    ),
  );
  return { id, lines };
}
function automatic(changes: any[]) {
  return {
    idempotencyKey: randomUUID(),
    producer: { type: "agent" as const, client: "remote-worker" },
    changes,
  };
}
function publishAutomatic(changes: any[]) {
  return tx(owner, ws, (c) =>
    publish(c, ws, automatic(changes), { userId: owner, scope: "publish" }),
  );
}
// claimText is the semantic content (must appear verbatim in change.content);
// quoteLine is the exact raw source line the evidence cites.
function decisionChange(
  clientRef: string,
  topicKey: string,
  sourceId: string,
  line: number,
  quoteLine: string,
  claimText: string,
  claimRelations: any[] = [],
) {
  return {
    topic: { key: topicKey, title: "결정성 게이트 검증" },
    clientRef,
    title: claimText,
    content: claimText,
    kind: "memory",
    claims: [
      {
        anchor: "decision",
        text: claimText,
        type: "user_decision",
        subject: "gate-subject-" + topicKey,
        scope: "production",
        state: "current",
        evidence: [
          { sourceId, revision: 1, lines: [line, line], quote: quoteLine },
        ],
      },
    ],
    claimRelations,
  };
}

test("DECISION_EVIDENCE_NOT_USER rejects a decision cited only to an assistant line", async () => {
  const content = "에이전트가 요약한 결정처럼 보이는 문장";
  const src = await source([
    JSON.stringify({ event: 1, field: '["payload","role"]', text: "assistant" }),
    JSON.stringify({ event: 1, field: '["payload","content"]', text: content }),
  ]);
  await assert.rejects(
    publishAutomatic([
      decisionChange("a", "gate-assistant-evidence", src.id, 2, src.lines[1], content),
    ]),
    (e: any) => e.code === "DECISION_EVIDENCE_NOT_USER",
  );
});

test("DECISION_EVIDENCE_NOT_USER accepts a decision cited to an actual user line", async () => {
  const content = "사용자가 직접 말한 결정 문장";
  const src = await source([
    JSON.stringify({ event: 1, field: '["payload","role"]', text: "user" }),
    JSON.stringify({ event: 1, field: '["payload","content"]', text: content }),
  ]);
  const result = await publishAutomatic([
    decisionChange("a", "gate-user-evidence", src.id, 2, src.lines[1], content),
  ]);
  assert.equal(result.items.length, 1);
});

test("DECISION_EVIDENCE_NOT_USER is skipped when the source has no resolvable role at all", async () => {
  const content = "역할 정보가 없는 평문 인용";
  const src = await source([content]);
  const result = await publishAutomatic([
    decisionChange("a", "gate-no-role-data", src.id, 1, src.lines[0], content),
  ]);
  assert.equal(
    result.items.length,
    1,
    "unavailable role data is not treated as a non-user author",
  );
});

// Every line of a timed source shares one event id, so a citation of the
// content line still resolves to the event's timestamp (evidence-time.ts).
async function timedSource(time: string, content: string, recovered = false) {
  return source([
    JSON.stringify({ event: 1, field: '["payload","role"]', text: "user" }),
    JSON.stringify({ event: 1, field: '["timestamp"]', text: time }),
    ...(recovered
      ? [
          JSON.stringify({
            event: 1,
            field: '["provenance","kind"]',
            text: "compaction_recovered",
          }),
        ]
      : []),
    JSON.stringify({ event: 1, field: '["payload","content"]', text: content }),
  ]);
}
function timedDecision(
  clientRef: string,
  topicKey: string,
  src: { id: string; lines: string[] },
  content: string,
  target?: { articleId: string; revision: number; anchor: string },
) {
  const line = src.lines.length;
  return decisionChange(
    clientRef,
    topicKey,
    src.id,
    line,
    src.lines[line - 1],
    content,
    target
      ? [
          {
            anchor: "decision",
            relation: "supersedes" as const,
            target,
            evidence: [
              { sourceId: src.id, revision: 1, lines: [line, line], quote: src.lines[line - 1] },
            ],
          },
        ]
      : [],
  );
}

test("SUPERSEDES_BACKWARD_IN_TIME rejects a replacement whose own evidence predates the claim it targets", async () => {
  const targetText = "최근 다시 MySQL로 확정한 결정",
    fromText = "이미 예전에 PostgreSQL로 바꿨다는 뒤늦은 기록";
  const targetSource = await timedSource("2026-06-01T00:00:00.000Z", targetText);
  const target = await publishAutomatic([
    timedDecision("t", "gate-backward-time", targetSource, targetText),
  ]);
  const fromSource = await timedSource("2020-01-01T00:00:00.000Z", fromText);
  await assert.rejects(
    publishAutomatic([
      timedDecision("f", "gate-backward-time", fromSource, fromText, {
        articleId: target.items[0].id,
        revision: target.items[0].revision,
        anchor: "decision",
      }),
    ]),
    (e: any) => e.code === "SUPERSEDES_BACKWARD_IN_TIME",
  );
});

test("SUPERSEDES_BACKWARD_IN_TIME is skipped when the superseding side has only recovered (compaction) times", async () => {
  const targetText = "최근 다시 Redis로 확정한 결정",
    fromText = "복구된 컴팩션 기록 속 이전 발언";
  const targetSource = await timedSource("2026-06-01T00:00:00.000Z", targetText);
  const target = await publishAutomatic([
    timedDecision("t", "gate-recovered-skip", targetSource, targetText),
  ]);
  // The FROM side's only time is 'recovered', not 'recorded': ordering is not
  // trustworthy, so the gate must not fire even though it looks backward.
  const fromSource = await timedSource("2020-01-01T00:00:00.000Z", fromText, true);
  const result = await publishAutomatic([
    timedDecision("f", "gate-recovered-skip", fromSource, fromText, {
      articleId: target.items[0].id,
      revision: target.items[0].revision,
      anchor: "decision",
    }),
  ]);
  assert.equal(result.items.length, 1);
});

// The gate means "at least one cited line is the user's", not "every line is".
// A decision backed by a user line plus a tool output is legitimate, and the
// merge path may add assistant-role corroboration to a claim that already has
// its user citation. Pinned so the rule is not silently tightened later.
test("DECISION_EVIDENCE_NOT_USER accepts a decision citing a user line alongside a non-user line", async () => {
  const userText = "사용자가 직접 말한 결정 문장";
  const toolText = "도구가 출력한 확인 결과";
  const src = await source([
    JSON.stringify({ event: 1, field: '["payload","role"]', text: "user" }),
    JSON.stringify({ event: 1, field: '["payload","content"]', text: userText }),
    JSON.stringify({ event: 2, field: '["payload","role"]', text: "tool" }),
    JSON.stringify({ event: 2, field: '["payload","content"]', text: toolText }),
  ]);
  const change = decisionChange(
    "a",
    "gate-mixed-evidence",
    src.id,
    2,
    src.lines[1],
    userText,
  );
  change.claims[0].evidence.push({
    sourceId: src.id,
    revision: 1,
    lines: [4, 4],
    quote: src.lines[3],
  });
  const result = await publishAutomatic([change]);
  assert.equal(result.items.length, 1, "one user-authored citation is enough");
});

// The worker downgrades ai_inference/current in its own proposal validation,
// but that rule lived only there — four such claims reached the wiki as
// settled fact beside the user's own decisions before it existed. Enforced on
// the server for the same reason DECISION_EVIDENCE_NOT_USER is: every
// automatic publisher passes through here.
test("AI_INFERENCE_NOT_CURRENT stops an automatic publish of an adopted interpretation", async () => {
  const content = "정제 하네스는 게이트와 모델 판단을 분리한다는 해석";
  const src = await source([content]);
  const change = decisionChange(
    "a",
    "gate-inference-current",
    src.id,
    1,
    src.lines[0],
    content,
  );
  change.claims[0].type = "ai_inference";
  await assert.rejects(
    publishAutomatic([change]),
    (e: any) => e.code === "AI_INFERENCE_NOT_CURRENT",
  );
  // The same claim as a proposal is fine: the assertion is worth keeping, its
  // adoption is not the model's to claim.
  const ok = decisionChange(
    "a",
    "gate-inference-proposed",
    src.id,
    1,
    src.lines[0],
    content,
  );
  ok.claims[0].type = "ai_inference";
  ok.claims[0].state = "proposed";
  const result = await publishAutomatic([ok]);
  assert.equal(result.items.length, 1);
});

// Two existing duplicates were treated as ambiguous, so a third copy was made
// and the reader saw the same sentence three times. Production had 29 such
// groups. The ORDER BY is a total order; there is nothing to disambiguate.
test("an identical automatic claim merges into the existing one, but not across topics", async () => {
  const content = "같은 문장이 여러 번 도착해도 지식은 하나다";
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const src = await source([
      JSON.stringify({ event: 1, field: '["payload","role"]', text: "user" }),
      JSON.stringify({ event: 1, field: '["payload","content"]', text: content }),
    ]);
    const result = await publishAutomatic([
      decisionChange("a", "merge-topic", src.id, 2, src.lines[1], content),
    ]);
    ids.push(result.items[0].id);
  }
  assert.equal(new Set(ids).size, 1, "one knowledge id, got " + ids.join(", "));
  const copies = await admin.query(
    `SELECT count(*)::int n FROM articles a JOIN claims cl ON cl.workspace_id=a.workspace_id AND cl.article_id=a.id AND cl.revision=a.revision
     WHERE a.workspace_id=$1 AND a.topic_key='merge-topic' AND a.deleted_at IS NULL AND cl.text=$2`,
    [ws, content],
  );
  assert.equal(copies.rows[0].n, 1, "no second copy of the claim");
  // Another topic keeps its own copy: the claim belongs on the page it was
  // extracted for, and merging across topics would move it off that page.
  const otherSource = await source([
    JSON.stringify({ event: 1, field: '["payload","role"]', text: "user" }),
    JSON.stringify({ event: 1, field: '["payload","content"]', text: content }),
  ]);
  const other = await publishAutomatic([
    decisionChange("a", "merge-other-topic", otherSource.id, 2, otherSource.lines[1], content),
  ]);
  assert.notEqual(other.items[0].id, ids[0]);

  // Now the state that produced the third copies: two identical claims already
  // in the same topic. The old rule called that ambiguous and made a third.
  const twin = randomUUID(),
    twinPub = randomUUID();
  await admin.query(
    `INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason)
     VALUES($1,$2,$3,'h','{"type":"agent","client":"synthetic"}','twin')`,
    [twinPub, ws, twinPub],
  );
  await admin.query(
    "INSERT INTO articles(id,workspace_id,title,content,kind,revision,topic_key) VALUES($1,$2,$3,$3,'memory',1,'merge-topic')",
    [twin, ws, content],
  );
  await admin.query(
    "INSERT INTO revisions(workspace_id,article_id,revision,title,content,metadata,publication_id) VALUES($1,$2,1,$3,$3,'{}',$4)",
    [ws, twin, content, twinPub],
  );
  await admin.query(
    "INSERT INTO claims(workspace_id,article_id,revision,anchor,text,type,subject,scope,state) VALUES($1,$2,1,'decision',$3,'user_decision',$4,'production','current')",
    [ws, twin, content, "gate-subject-merge-topic"],
  );
  const twinSource = await source([
    JSON.stringify({ event: 1, field: '["payload","role"]', text: "user" }),
    JSON.stringify({ event: 1, field: '["payload","content"]', text: content }),
  ]);
  await admin.query(
    "INSERT INTO evidence(workspace_id,article_id,revision,anchor,source_id,source_revision,line_start,line_end,quote) VALUES($1,$2,1,'decision',$3,1,2,2,$4)",
    [ws, twin, twinSource.id, twinSource.lines[1]],
  );
  const third = await source([
    JSON.stringify({ event: 1, field: '["payload","role"]', text: "user" }),
    JSON.stringify({ event: 1, field: '["payload","content"]', text: content }),
  ]);
  const merged = await publishAutomatic([
    decisionChange("a", "merge-topic", third.id, 2, third.lines[1], content),
  ]);
  assert.equal(
    merged.items[0].id,
    ids[0],
    "merges into the oldest duplicate instead of making a third",
  );
  const after = await admin.query(
    `SELECT count(*)::int n FROM articles a JOIN claims cl ON cl.workspace_id=a.workspace_id AND cl.article_id=a.id AND cl.revision=a.revision
     WHERE a.workspace_id=$1 AND a.topic_key='merge-topic' AND a.deleted_at IS NULL AND cl.text=$2`,
    [ws, content],
  );
  assert.equal(after.rows[0].n, 2, "still the two that existed, no third");
});
