import { test } from "node:test";
import assert from "node:assert/strict";
import { refinementSchedule } from "../apps/api/src/refinement-progress.js";

const now = new Date("2026-09-13T23:50:00Z");
const state = {
  enabled: true,
  hasKey: true,
  calls: 1,
  dailyCalls: 24,
  pending: 2,
  running: 0,
  failed: 0,
  earliest: null,
  cooldown: null,
  now,
};

test("progress distinguishes manual pause, provider cooldown, daily allowance, and input failures", () => {
  assert.deepEqual(refinementSchedule({ ...state, enabled: false }), {
    reason: "paused",
    nextAttemptAt: null,
  });
  assert.deepEqual(refinementSchedule({ ...state, hasKey: false }), {
    reason: "key_missing",
    nextAttemptAt: null,
  });
  assert.deepEqual(refinementSchedule({ ...state, pending: 0, failed: 1 }), {
    reason: "needs_attention",
    nextAttemptAt: null,
  });
  assert.deepEqual(refinementSchedule({ ...state, running: 1 }), {
    reason: "running",
    nextAttemptAt: null,
  });
  assert.deepEqual(
    refinementSchedule({
      ...state,
      calls: 24,
      cooldown: "2026-09-13T23:51:00Z",
    }),
    { reason: "daily_limit", nextAttemptAt: "2026-09-14T00:00:00.000Z" },
  );
  assert.deepEqual(
    refinementSchedule({
      ...state,
      calls: 24,
      cooldown: "2026-09-14T01:00:00Z",
    }),
    { reason: "provider_cooldown", nextAttemptAt: "2026-09-14T01:00:00.000Z" },
  );
  assert.deepEqual(
    refinementSchedule({ ...state, earliest: "2026-09-13T23:52:00Z" }),
    { reason: "retry_wait", nextAttemptAt: "2026-09-13T23:52:00.000Z" },
  );
});
