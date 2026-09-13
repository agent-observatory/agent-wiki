import { test } from "node:test";
import assert from "node:assert/strict";
import {
  modelRecords,
  resolveRecordEvidence,
} from "../packages/core/src/model-records.js";
import { summarizeModelEvidence } from "../packages/core/src/model-evidence.js";
const text = JSON.stringify({
  text: '줄바꿈\n따옴표 " · \\ escape',
  event: 1,
  field: '["text"]',
});
const source = {
  id: "source",
  revision: 1,
  start: 21,
  end: 23,
  text: text + "\n\nomitted",
  omittedLines: [{ start: 23, end: 23 }],
};
const proposal = (e: any) => ({
  changes: [
    { claims: [{ evidence: [e] }], claimRelations: [{ evidence: [e] }] },
  ],
});
test("record selection restores exact original escaped text for claims and change reasons", () => {
  const input = proposal({ recordId: "record-21" });
  const result = resolveRecordEvidence(input, source);
  const evidence = result.changes.flatMap((c: any) =>
    [...c.claims, ...c.claimRelations].flatMap((i: any) => i.evidence),
  );
  assert.equal(summarizeModelEvidence(evidence, source).matched, 2);
  assert.equal(evidence[0].quote, text);
  assert.deepEqual(input, proposal({ recordId: "record-21" }));
  assert.equal(modelRecords(source).length, 1);
});
test("foreign, omitted, blank and fabricated records cannot be evidence", () => {
  for (const id of [
    "record-1",
    "record-22",
    "record-23",
    "record-24",
    "record-21-extra",
  ])
    assert.throws(
      () => resolveRecordEvidence(proposal({ recordId: id }), source),
      /AI_EVIDENCE_REFERENCE_INVALID/,
    );
  assert.throws(() =>
    resolveRecordEvidence(
      proposal({ recordId: "record-21", quote: "invented" }),
      source,
    ),
  );
});
