import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { PoolClient } from "pg";
import { tx } from "./db.js";

// Shared across this owner's workspaces and models using the same host/key.
// Never persist the API key itself or expose the fingerprint through the API.
export function modelGateKey(baseUrl: string, secret: string) {
  return createHash("sha256")
    .update(new URL(baseUrl).origin + "\0" + secret)
    .digest("hex");
}

export async function gateReady(c: PoolClient, owner: string, key: string) {
  const row = (
    await c.query(
      "SELECT next_allowed_at<=clock_timestamp() AS ready FROM model_request_gates WHERE owner_id=$1 AND key_hash=$2",
      [owner, key],
    )
  ).rows[0];
  return !row || row.ready;
}

// Atomic reservations also cover NVIDIA result polling. The timestamp survives
// Worker restarts; sleeping holds neither a transaction nor a DB connection.
export async function waitForModelSlot(
  owner: string,
  key: string,
  signal: AbortSignal,
  requestsPerMinute = 20,
) {
  while (true) {
    signal.throwIfAborted();
    const waitMs = await tx(owner, null, async (c) => {
      await c.query(
        "INSERT INTO model_request_gates(owner_id,key_hash) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [owner, key],
      );
      const row = (
        await c.query(
          "SELECT greatest(0,extract(epoch FROM(next_allowed_at-clock_timestamp()))*1000)::float8 AS wait_ms FROM model_request_gates WHERE owner_id=$1 AND key_hash=$2 FOR UPDATE",
          [owner, key],
        )
      ).rows[0];
      if (row.wait_ms > 0) return row.wait_ms as number;
      await c.query(
        "UPDATE model_request_gates SET next_allowed_at=clock_timestamp()+make_interval(secs=>$3) WHERE owner_id=$1 AND key_hash=$2",
        [owner, key, 60 / Math.min(120, Math.max(1, requestsPerMinute))],
      );
      return 0;
    });
    if (waitMs === 0) {
      signal.throwIfAborted();
      return;
    }
    await sleep(Math.min(Math.ceil(waitMs), 3000), undefined, { signal });
  }
}

export function retryDelay(
  retryAfter: number | null = null,
  random = Math.random(),
  baseSeconds = 120,
) {
  // Retain failure counts for diagnosis without making this personal wiki wait
  // exponentially longer. Keep a five-second margin beyond the provider Retry-After.
  return Math.max(
    (retryAfter ?? 0) + 5,
    Math.ceil(baseSeconds * (1 + 0.2 * random)),
  );
}

export async function coolDownModel(
  c: PoolClient,
  owner: string,
  key: string,
  retryAfter: number | null,
  baseSeconds = 120,
) {
  await c.query(
    "INSERT INTO model_request_gates(owner_id,key_hash,failures) VALUES($1,$2,1) ON CONFLICT(owner_id,key_hash) DO UPDATE SET failures=least(model_request_gates.failures+1,32)",
    [owner, key],
  );
  const seconds = retryDelay(retryAfter, Math.random(), baseSeconds);
  await c.query(
    "UPDATE model_request_gates SET next_allowed_at=greatest(next_allowed_at,clock_timestamp()+make_interval(secs=>$3)) WHERE owner_id=$1 AND key_hash=$2",
    [owner, key, seconds],
  );
  return seconds;
}

export async function modelResponded(owner: string, key: string) {
  await tx(owner, null, (c) =>
    c.query(
      "UPDATE model_request_gates SET failures=0 WHERE owner_id=$1 AND key_hash=$2",
      [owner, key],
    ),
  );
}
