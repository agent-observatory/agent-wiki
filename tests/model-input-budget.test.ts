import { test } from "node:test";
import assert from "node:assert/strict";
import { planChunks, estimateTokens } from "../packages/core/src/chunking.js";
import { fitModelChunk } from "../packages/core/src/model-input-budget.js";

test("dense role and omitted-row metadata cannot reject a splittable planned chunk", () => {
  const lines = Array.from({ length: 228 }, (_, i) =>
    JSON.stringify({ event: i, text: "fact" }),
  );
  const chunks = planChunks(lines.join("\n"), 12000);
  const build = (c: (typeof chunks)[number]) => ({
    source: {
      start: c.start,
      end: c.end,
      text: lines.slice(c.start - 1, c.end).join("\n"),
      roles: Array.from({ length: c.end - c.start + 1 }, (_, i) => ({
        start: c.start + i,
        end: c.start + i,
        role: i % 2 ? "user" : "tool",
      })),
      omittedLines: Array.from({ length: c.end - c.start + 1 }, (_, i) => ({
        start: c.start + i,
        end: c.start + i,
        reason: "session_metadata",
      })),
    },
  });
  const measure = (input: ReturnType<typeof build>) =>
    estimateTokens(JSON.stringify(input)) + 400;
  assert.ok(
    measure(build(chunks[0])) > 15000,
    "reproduce full envelope exceeding its planned body budget",
  );
  const fit = fitModelChunk(chunks, 0, build, measure, 15000);
  assert.ok(fit.estimatedTokens <= 15000);
  assert.equal(fit.chunks[0].start, 1);
  assert.equal(fit.chunks.at(-1)!.end, 228);
  fit.chunks.forEach((c, i) => {
    if (i) assert.equal(c.start, fit.chunks[i - 1].end + 1);
  });
});

test("splitting a later chunk preserves completed coverage and eventually consumes the whole tail", () => {
  let chunks = [
    { start: 1, end: 10, contextStart: 1, contextEnd: 0 },
    { start: 11, end: 40, contextStart: 1, contextEnd: 3 },
  ];
  const completed = chunks[0];
  for (let index = 1; index < chunks.length; index++) {
    const fit = fitModelChunk(
      chunks,
      index,
      (c) => ({ ...c }),
      (c) => (c.end - c.start + 1) * 10 + 30,
      100,
    );
    chunks = fit.chunks;
    assert.ok(fit.estimatedTokens <= 100);
  }
  assert.equal(chunks[0], completed);
  assert.equal(chunks.at(-1)!.end, 40);
  chunks.forEach((c, i) => {
    if (i) assert.equal(c.start, chunks[i - 1].end + 1);
  });
});

test("an irreducible oversized row fails without losing or mutating source coverage", () => {
  const chunks = [{ start: 1, end: 1, contextStart: 1, contextEnd: 0 }];
  assert.throws(
    () =>
      fitModelChunk(
        chunks,
        0,
        (c) => c,
        () => 101,
        100,
      ),
    /AI_INPUT_LIMIT/,
  );
  assert.equal(chunks[0].end, 1);
});
