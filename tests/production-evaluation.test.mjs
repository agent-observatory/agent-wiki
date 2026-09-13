import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compare,
  sourceDigest,
} from "../experiments/curation/production/report.mjs";
const base = () => ({
  workspace: "fixture",
  casesHash: "fixed",
  capturedAt: "before",
  settings: { model: "fixture" },
  sources: [{ id: "a", content_hash: "fixed", line_count: 3 }],
  runs: [],
  jobs: [],
  articles: [],
  revisions: [],
  claims: [],
  relations: [],
});
const call = (id, usage, status = "completed", extra = {}) => ({
  id,
  usage,
  status,
  settings: { model: "fixture" },
  prompt_version: "fixture",
  diagnostics: { requestedAt: "now", attempt: 1, durationMs: 100, ...extra },
});
test("counts actual requests, preserves unknown usage and never adds subset tokens twice", () => {
  const before = base(),
    after = {
      ...base(),
      capturedAt: "after",
      runs: [
        call("ok", {
          prompt_tokens: 100,
          completion_tokens: 40,
          prompt_tokens_details: { cached_tokens: 60 },
          completion_tokens_details: { reasoning_tokens: 30 },
        }),
        call("timeout", null, "failed", { attempt: 2, stage: "model" }),
        {
          id: "publish-only",
          status: "completed",
          diagnostics: { recoveryOf: "earlier" },
          usage: { total_tokens: 0 },
        },
      ],
    };
  const r = compare(before, after);
  assert.equal(r.modelCalls, 2);
  assert.equal(r.executions, 3);
  assert.equal(r.retries, 1);
  assert.deepEqual(r.usage.input, {
    reported: 100,
    reportedCalls: 1,
    unreportedCalls: 1,
  });
  assert.equal(r.usage.output.reported, 40);
  assert.equal(r.usage.reasoningOutput.reported, 30);
  assert.equal(r.retryUsage.input.unreportedCalls, 1);
});
test("excludes preserved old attempts after rebuild and rejects changed evaluation identity", () => {
  const before = { ...base(), runs: [call("old", { prompt_tokens: 100 })] };
  const after = {
    ...base(),
    runs: [...before.runs, call("new", { prompt_tokens: 7 })],
  };
  assert.equal(compare(before, after).usage.input.reported, 7);
  assert.throws(
    () => compare(before, { ...after, workspace: "another" }),
    /WORKSPACE/,
  );
  assert.throws(
    () => compare(before, { ...after, casesHash: "tuned" }),
    /CASES/,
  );
});
test("detects incoming increments, changed hashes and missing sources; ordering does not matter", () => {
  const before = base(),
    after = {
      ...base(),
      sources: [
        { id: "a", content_hash: "changed", line_count: 3 },
        { id: "b", content_hash: "new", line_count: 1 },
      ],
    };
  const r = compare(before, after).sourceComparison;
  assert.equal(r.sameInputs, false);
  assert.equal(r.added, 1);
  assert.equal(r.changed, 1);
  assert.equal(
    compare(before, { ...after, sources: [] }).sourceComparison.removed,
    1,
  );
  assert.equal(
    sourceDigest(after.sources),
    sourceDigest([...after.sources].reverse()),
  );
});
