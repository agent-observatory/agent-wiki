import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorModelEvidence } from "../packages/core/src/model-evidence.js";

const record = (text: string) =>
  JSON.stringify({ event: 1, field: '["payload","content",0,"text"]', text });
const raw = record("Use A.\nCancel A and use B.");
const source = {
  id: "source",
  revision: 1,
  start: 159,
  end: 160,
  text: record("Earlier context.") + "\n" + raw,
};
const evidence = {
  sourceId: "source",
  revision: 1,
  lines: [10, 13] as [number, number],
  quote: "Cancel A and use B.",
};

test("anchors an exact decoded quote to the immutable row without changing source", () => {
  const before = JSON.stringify(source);
  assert.deepEqual(anchorModelEvidence(evidence, source), {
    ...evidence,
    lines: [160, 160],
    quote: raw,
  });
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(evidence.lines, [10, 13]);
  assert.equal(
    anchorModelEvidence({ ...evidence, lines: [160, 160], quote: raw }, source),
    null,
  );
});

test("ambiguous, missing, foreign and fuzzy quotes cannot be relocated", () => {
  for (const text of [
    raw + "\n" + raw,
    record(evidence.quote + " " + evidence.quote),
    record("A different claim."),
  ])
    assert.equal(anchorModelEvidence(evidence, { ...source, text }), null);
  assert.equal(
    anchorModelEvidence({ ...evidence, sourceId: "other" }, source),
    null,
  );
  assert.equal(anchorModelEvidence({ ...evidence, revision: 2 }, source), null);
  assert.equal(
    anchorModelEvidence({ ...evidence, quote: "cancel A and use B." }, source),
    null,
  );
  assert.equal(anchorModelEvidence({ ...evidence, quote: " " }, source), null);
  assert.equal(anchorModelEvidence(evidence, { ...source, text: "\n" }), null);
});
