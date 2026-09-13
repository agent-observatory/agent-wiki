import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeModelIdentifiers } from "../packages/core/src/model-identifiers.js";
const change = (clientRef: string) => ({
  clientRef,
  articleId: null as string | null,
  links: [] as string[],
  claims: [
    { anchor: "decision", text: "A" },
    { anchor: "decision", text: "B" },
    { anchor: "claim-1", text: "C" },
  ],
  claimRelations: [] as { anchor: string }[],
});
test("duplicate local identifiers get deterministic collision-free names without changing claims or stored output", () => {
  const input = [
    change("new-memory"),
    change("new-memory"),
    change("change-1"),
  ];
  const before = structuredClone(input);
  const result = normalizeModelIdentifiers(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result, normalizeModelIdentifiers(input));
  assert.equal(result.renamedReferences, 1);
  assert.equal(result.renamedAnchors, 3);
  assert.deepEqual(
    result.changes.map((c) => c.clientRef),
    ["new-memory", "change-2", "change-1"],
  );
  assert.deepEqual(
    result.changes[0].claims.map((c) => c.anchor),
    ["decision", "claim-2", "claim-1"],
  );
  assert.deepEqual(
    result.changes[0].claims.map((c) => c.text),
    ["A", "B", "C"],
  );
  assert.equal(normalizeModelIdentifiers(result.changes).renamedAnchors, 0);
});
test("ambiguous references and existing article edits remain invalid rather than guessing a target", () => {
  const input = [change("new-memory"), change("new-memory")];
  input[0].links = ["new-memory"];
  input[0].claimRelations = [{ anchor: "decision" }];
  input[1].articleId = "existing";
  const result = normalizeModelIdentifiers(input);
  assert.deepEqual(result.changes, input);
  assert.equal(result.renamedReferences, 0);
  assert.equal(result.renamedAnchors, 0);
});
test("same-batch relation targets prevent renaming ambiguous references or target anchors", () => {
  const input = [
    change("old"),
    change("old"),
    {
      ...change("new"),
      claims: [{ anchor: "new-decision", text: "D" }],
      claimRelations: [
        {
          anchor: "new-decision",
          target: { clientRef: "old", anchor: "decision" },
        },
      ],
    },
  ];
  const result = normalizeModelIdentifiers(input);
  assert.equal(result.renamedReferences, 0);
  assert.equal(result.renamedAnchors, 0);
  assert.deepEqual(result.changes, input);
});
