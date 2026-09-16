import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLocalHistoryStates } from "../packages/core/src/local-history.js";
const change = (ref: string, state: string, prior?: string) => ({
  clientRef: ref,
  claims: [
    {
      anchor: "decision",
      state,
      type: "user_decision",
      subject: "provider",
      scope: "general",
    },
  ],
  claimRelations: prior
    ? [
        {
          anchor: "decision",
          relation: "supersedes",
          target: { clientRef: prior, anchor: "decision" },
        },
      ]
    : [],
});
test("redundant historical states are derived from an explicit same-batch chain", () => {
  const input = [
    change("a", "superseded"),
    change("b", "superseded", "a"),
    change("c", "current", "b"),
  ];
  const result = normalizeLocalHistoryStates(input);
  assert.equal(result.normalized, 2);
  assert.ok(result.changes.every((c) => c.claims[0].state === "current"));
  assert.equal(
    input[0].claims[0].state,
    "superseded",
    "preserve original model response",
  );
});
test("unlinked, cross-scope, proposed or downgraded claims cannot authorize state normalization", () => {
  assert.equal(
    normalizeLocalHistoryStates([change("a", "superseded")]).normalized,
    0,
  );
  for (const variant of ["scope", "proposed", "authority"]) {
    const input = [change("a", "superseded"), change("b", "current", "a")];
    if (variant === "scope") input[1].claims[0].scope = "local";
    if (variant === "proposed") input[1].claims[0].state = "proposed";
    if (variant === "authority") input[1].claims[0].type = "unconfirmed";
    assert.equal(normalizeLocalHistoryStates(input).normalized, 0);
  }
});
