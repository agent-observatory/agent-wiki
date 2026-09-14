import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import { hash, putSource } from "../packages/core/src/storage.js";
import { defaults, encryptSecret } from "../packages/core/src/ai.js";
import { runOne } from "../apps/agent-wiki-worker/src/worker.js";
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
after(async () => {
  await pool.end();
  await admin.end();
});
for (const variant of ["off", "high", "record-reference"])
  test(`captured Alibaba ${variant} output passes Worker publication with preserved provider history`, async () => {
    const fixture = JSON.parse(
      await readFile(
        variant === "record-reference"
          ? "tests/fixtures/record-reference.json"
          : "experiments/curation/lineage/input.json",
        "utf8",
      ),
    );
    const captured = JSON.parse(
      await readFile(
        variant === "record-reference"
          ? "tests/fixtures/record-reference.json"
          : variant === "off"
            ? "experiments/curation/lineage/result.json"
            : "experiments/curation/lineage/result-thinking-high.json",
        "utf8",
      ),
    );
    const owner = "lineage-replay-" + randomUUID(),
      ws = randomUUID(),
      id = randomUUID();
    process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    const text = fixture.source.text
      .split("\n")
      .flatMap((text: string, event: number) => [
        JSON.stringify({
          event,
          field: JSON.stringify(["payload", "role"]),
          text: "user",
        }),
        JSON.stringify({
          event,
          field: JSON.stringify(["payload", "message"]),
          text,
        }),
      ])
      .join("\n");
    const key = ws + "/" + hash(text) + ".txt.gz";
    await putSource(key, text);
    await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
    await admin.query(
      "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,'Synthetic captured response')",
      [ws, owner],
    );
    await tx(owner, ws, async (c) => {
      await c.query(
        "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3)",
        [
          ws,
          {
            ...defaults,
            enabled: true,
            primary: { ...defaults.primary, maxInputTokens: 25000 },
          },
          encryptSecret("synthetic"),
        ],
      );
      await c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1::uuid,$2,'Synthetic','conversation',$1::text,$3,$3,$4,$5,$1::text,true)",
        [id, ws, hash(text), key, text.split("\n").length],
      );
      await c.query(
        "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
        [randomUUID(), ws, id],
      );
    });
    const output = structuredClone(captured.output);
    // Legacy recorded responses predate topics; explicitly supply a fixture topic.
    for (const change of output.changes)
      change.topic ??= { key: "ai-curation", title: "AI 정제 연결" };
    for (const change of output.changes)
      for (const item of [...change.claims, ...change.claimRelations])
        for (const evidence of item.evidence) {
          if (evidence.recordId) {
            evidence.recordId =
              "record-" + Number(evidence.recordId.slice(7)) * 2;
            continue;
          }
          evidence.sourceId = id;
          evidence.lines = evidence.lines.map((line: number) => line * 2);
        }
    let calls = 0;
    await runOne(owner, new AbortController().signal, async () => {
      calls++;
      return { output, usage: captured.usage };
    });
    assert.equal(calls, 1, "replay does not call a live provider");
    const job = (
      await admin.query(
        "SELECT status,error_code FROM refinement_jobs WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0];
    assert.equal(job.status, "completed", JSON.stringify(job));
    const relations = (
      await admin.query(
        "SELECT relation,evidence FROM claim_relations WHERE workspace_id=$1",
        [ws],
      )
    ).rows;
    assert.equal(
      relations.filter((r) => r.relation === "supersedes").length,
      1,
    );
    const diagnostics = (
      await admin.query(
        "SELECT diagnostics FROM refinement_runs WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0].diagnostics;
    assert.equal(
      diagnostics.normalizedLocalHistoryStates,
      variant === "off" ? 1 : 0,
    );
    assert.ok(
      relations
        .find((r) => r.relation === "supersedes")
        .evidence[0].quote.includes("지연"),
    );
    const claims = (
      await admin.query(
        "SELECT text,scope,state FROM claims WHERE workspace_id=$1",
        [ws],
      )
    ).rows;
    if (variant !== "record-reference")
      assert.ok(
        claims.some(
          (c) => c.scope === "local-experiment" && c.text.includes("NVIDIA"),
        ),
      );
    const pages = (
      await admin.query("SELECT * FROM wiki_pages WHERE workspace_id=$1", [ws])
    ).rows;
    assert.equal(pages.length, 1);
    assert.match(pages[0].content, /Decision History/);
    assert.ok(
      !claims.some(
        (c) => c.text.includes("ExampleCloud") && c.state === "current",
      ),
    );
  });
