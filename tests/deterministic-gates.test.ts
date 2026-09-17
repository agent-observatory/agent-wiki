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
