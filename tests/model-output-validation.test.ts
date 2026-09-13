import { test } from "node:test";
import assert from "node:assert/strict";
import { changeInput } from "../apps/agent-wiki-api/src/knowledge.js";
import { OUTPUT_RETRY_CODES } from "../apps/agent-wiki-worker/src/worker.js";
const evidence = {
  sourceId: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  lines: [1, 1],
  quote: "합성 근거",
};
const change = {
  clientRef: "new",
  title: "합성 주장",
  content: "제안입니다.",
  claims: [
    {
      anchor: "new-claim",
      text: "제안입니다.",
      type: "ai_inference",
      state: "proposed",
      evidence: [evidence],
    },
  ],
  claimRelations: [
    {
      anchor: "old-claim",
      relation: "supports",
      target: {
        articleId: "00000000-0000-4000-8000-000000000002",
        revision: 1,
        anchor: "old-claim",
      },
      evidence: [evidence],
    },
  ],
};
test("relation source must be a claim in its own change before publication", () => {
  const result = changeInput.safeParse(change);
  assert.equal(result.success, false);
  if (!result.success)
    assert.deepEqual(result.error.issues[0].path, [
      "claimRelations",
      0,
      "anchor",
    ]);
  assert.equal(
    changeInput.safeParse({
      ...change,
      claimRelations: [{ ...change.claimRelations[0], anchor: "new-claim" }],
    }).success,
    true,
  );
});
test("proposal state cannot replace authority type and invalid output can regenerate", () => {
  const result = changeInput.safeParse({
    ...change,
    claimRelations: [],
    claims: [{ ...change.claims[0], type: "proposed" }],
  });
  assert.equal(result.success, false);
  assert.ok(OUTPUT_RETRY_CODES.includes("AI_INVALID_OUTPUT"));
  assert.ok(OUTPUT_RETRY_CODES.includes("CLAIM_RELATION_TARGET_INVALID"));
  assert.ok(!OUTPUT_RETRY_CODES.includes("SOURCE_AUTH_FAILED"));
});

test("relations cannot be nested in a claim instead of the change", () => {
  const result = changeInput.safeParse({
    ...change,
    claimRelations: [],
    claims: [{ ...change.claims[0], relations: [] }],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues[0].code, "unrecognized_keys");
    assert.deepEqual(result.error.issues[0].path, ["claims", 0]);
  }
});
