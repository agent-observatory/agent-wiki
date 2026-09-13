import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorModelEvidence,
  normalizeModelEvidence,
  summarizeModelEvidence,
} from "../packages/core/src/model-evidence.js";

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

test("only positive single-row evidence is normalized and the original response remains intact", () => {
  const input = {
    changes: [
      {
        claims: [
          {
            evidence: [
              { lines: [163] },
              { lines: [] },
              { lines: [0] },
              { lines: [1, 2, 3] },
              { lines: ["163"] },
            ],
          },
        ],
        claimRelations: [{ evidence: [{ lines: [159] }] }],
      },
    ],
  };
  assert.deepEqual(normalizeModelEvidence(input), {
    changes: [
      {
        claims: [
          {
            evidence: [
              { lines: [163, 163] },
              { lines: [] },
              { lines: [0] },
              { lines: [1, 2, 3] },
              { lines: ["163"] },
            ],
          },
        ],
        claimRelations: [{ evidence: [{ lines: [159, 159] }] }],
      },
    ],
  });
  assert.deepEqual(input.changes[0].claims[0].evidence[0].lines, [163]);
  for (const value of [null, [], { changes: [null] }])
    assert.deepEqual(normalizeModelEvidence(value), value);
});

test("evidence diagnostics count exact source positions without treating paraphrases or foreign sources as matches", () => {
  const valid = {
    ...evidence,
    lines: [160, 160] as [number, number],
    quote: raw,
  };
  const input = [
    valid,
    { ...valid, quote: "paraphrased" },
    { ...valid, sourceId: "other" },
    { ...valid, revision: 2 },
    { ...valid, lines: [159, 159] as [number, number] },
  ];
  assert.deepEqual(summarizeModelEvidence(input, source), {
    checked: 5,
    matched: 1,
    mismatched: 4,
  });
  assert.deepEqual(summarizeModelEvidence([], source), {
    checked: 0,
    matched: 0,
    mismatched: 0,
  });
  assert.equal(input[1].quote, "paraphrased");
});

test("anchors verbatim quotations across contiguous transport segments without joining different fields or gaps", () => {
  const segment = (
    n: number,
    text: string,
    event = 2,
    field = '["payload","content",0,"text"]',
  ) => JSON.stringify({ event, field, segment: n, text });
  const rows = [
    segment(5, "Before: preserve the user's notifi"),
    segment(6, "cation intent. After."),
  ];
  const input = { ...source, start: 95, end: 96, text: rows.join("\n") };
  const quote = "preserve the user's notification intent.";
  const ev = { ...evidence, quote, lines: [95, 95] as [number, number] };
  assert.deepEqual(anchorModelEvidence(ev, input), {
    ...ev,
    lines: [95, 96],
    quote: rows.join("\n"),
  });
  for (const second of [
    segment(7, "cation intent. After."),
    segment(6, "cation intent. After.", 3),
    segment(6, "cation intent. After.", 2, '["other"]'),
  ]) {
    assert.equal(
      anchorModelEvidence(ev, { ...input, text: rows[0] + "\n" + second }),
      null,
    );
  }
  assert.equal(
    anchorModelEvidence(
      { ...ev, quote: "preserve the user's notification intention." },
      input,
    ),
    null,
  );
  assert.equal(
    anchorModelEvidence(ev, {
      ...input,
      end: 97,
      text: rows[0] + "\n\n" + rows[1],
    }),
    null,
  );
});

test("batch source boundaries do not concatenate unrelated decoded field segments", () => {
  const rows = [
    JSON.stringify({ event: 1, field: '["text"]', segment: 0, text: "Alpha" }),
    JSON.stringify({ event: 1, field: '["text"]', segment: 1, text: "Beta" }),
  ];
  const source = {
    id: "source",
    revision: 1,
    start: 1,
    end: 2,
    text: rows.join("\n"),
    spans: [{ start: 1 }, { start: 2 }],
  };
  assert.equal(
    anchorModelEvidence(
      { sourceId: "source", revision: 1, lines: [1, 2], quote: "AlphaBeta" },
      source,
    ),
    null,
  );
});
