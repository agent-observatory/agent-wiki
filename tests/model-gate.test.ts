import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, tx } from "../packages/core/src/db.js";
import {
  modelGateKey,
  waitForModelSlot,
  gateReady,
  coolDownModel,
  modelResponded,
  retryDelay,
} from "../packages/core/src/model-gate.js";

const owner = "model-gate-" + randomUUID();
const other = "model-gate-" + randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const key = modelGateKey(
  "https://integrate.api.nvidia.com/v1",
  "synthetic-key",
);
before(async () => {
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1),($2,$2)", [
    owner,
    other,
  ]);
});
after(async () => {
  await pool.end();
  await admin.end();
});

test("atomic slots persist a three-second gap; a second caller can be aborted without sending", async () => {
  await waitForModelSlot(owner, key, new AbortController().signal);
  const remaining = (
    await admin.query(
      "SELECT extract(epoch FROM(next_allowed_at-now())) AS seconds FROM model_request_gates WHERE owner_id=$1",
      [owner],
    )
  ).rows[0];
  assert.ok(Number(remaining.seconds) > 2 && Number(remaining.seconds) <= 3);
  await assert.rejects(waitForModelSlot(owner, key, AbortSignal.timeout(50)), {
    name: "AbortError",
  });
  assert.equal(await tx(owner, null, (c) => gateReady(c, owner, key)), false);
});

test("cooldowns span workspaces using a key, survive new transactions, and do not block another key", async () => {
  const delays: number[] = [];
  for (let i = 0; i < 5; i++) {
    delays.push(await tx(owner, null, (c) => coolDownModel(c, owner, key, 0)));
  }
  assert.ok(delays[0] >= 120 && delays[0] <= 144);
  assert.ok(delays[4] >= 1920 && delays[4] <= 2304);
  // Checking from another workspace uses the same durable gate.
  assert.equal(
    await tx(owner, randomUUID(), (c) => gateReady(c, owner, key)),
    false,
  );
  const anotherKey = modelGateKey(
    "https://integrate.api.nvidia.com/v1",
    "other-synthetic-key",
  );
  await waitForModelSlot(owner, anotherKey, new AbortController().signal);
  assert.equal(
    (
      await tx(other, null, (c) =>
        c.query("SELECT * FROM model_request_gates WHERE owner_id=$1", [owner]),
      )
    ).rowCount,
    0,
  );
  await modelResponded(owner, key);
  assert.equal(
    (
      await admin.query(
        "SELECT failures FROM model_request_gates WHERE owner_id=$1 AND key_hash=$2",
        [owner, key],
      )
    ).rows[0].failures,
    0,
  );
});

test("backoff grows, stops growing after one hour plus jitter, and honors longer Retry-After", () => {
  assert.equal(retryDelay(1, 0, 0), 120);
  assert.equal(retryDelay(2, 0, 0), 240);
  assert.equal(retryDelay(999999, 0, 0), 3600);
  assert.equal(retryDelay(999999, 0, 1), 4320);
  assert.equal(retryDelay(1, 99999, 0), 99999);
});
