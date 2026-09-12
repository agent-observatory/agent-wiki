import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
test("real SIGTERM drains an accepted DB request before process exit", async () => {
  const db = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await db.connect();
  const ws = randomUUID();
  const token = randomUUID();
  await db.query(
    "INSERT INTO users(id,login) VALUES('shutdown-owner','shutdown') ON CONFLICT DO NOTHING",
  );
  await db.query(
    "INSERT INTO workspaces(id,owner_id,name) VALUES($1,'shutdown-owner','shutdown')",
    [ws],
  );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,'shutdown-owner',now()+interval '1 hour')",
    [createHash("sha256").update(token).digest("hex")],
  );
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/api/src/server.ts"],
    {
      env: {
        ...process.env,
        PORT: "3210",
        OWNER_GITHUB_ID: "shutdown-owner",
        PGAPPNAME: "wiki-shutdown-test",
        GITHUB_CLIENT_ID: "",
        GITHUB_CLIENT_SECRET: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (x) => (output += x));
  child.stderr.on("data", (x) => (output += x));
  const exit = once(child, "exit");
  try {
    for (let i = 0; i < 100 && !output.includes("api_started"); i++)
      await delay(100);
    assert.ok(output.includes("api_started"), output);
    await db.query("BEGIN");
    await db.query("LOCK TABLE articles IN ACCESS EXCLUSIVE MODE");
    const accepted = fetch(
      `http://127.0.0.1:3210/api/workspaces/${ws}/articles`,
      {
        headers: { cookie: "wiki_session=" + token },
        signal: AbortSignal.timeout(10000),
      },
    );
    let blocked = false;
    for (let i = 0; i < 50; i++) {
      await db.query("SELECT pg_stat_clear_snapshot()");
      const rows = await db.query(
        "SELECT 1 FROM pg_stat_activity WHERE application_name='wiki-shutdown-test' AND wait_event_type='Lock'",
      );
      if (rows.rowCount) {
        blocked = true;
        break;
      }
      await delay(100);
    }
    assert.ok(blocked, "Request reached DB before SIGTERM");
    child.kill("SIGTERM");
    for (let i = 0; i < 30 && !output.includes("api_draining"); i++)
      await delay(50);
    assert.ok(output.includes("api_draining"));
    const later = await fetch("http://127.0.0.1:3210/readyz", {
      signal: AbortSignal.timeout(1000),
    })
      .then((r) => r.status)
      .catch(() => 503);
    assert.equal(later, 503);
    await db.query("COMMIT");
    assert.equal((await accepted).status, 200);
    const [code] = await exit;
    assert.equal(code, 0, output);
    assert.ok(output.includes("api_stopped"));
  } finally {
    await db.query("ROLLBACK");
    await db.end();
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
