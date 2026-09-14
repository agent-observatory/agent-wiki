import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults } from "../packages/core/src/ai.js";
import { estimateTokens, planChunks } from "../packages/core/src/chunking.js";
import { inputTokenCounter } from "../packages/core/src/input-tokens.js";

test("Qwen packs mixed Korean/code near its 25K estimate without losing rows", async () => {
  const counter = await inputTokenCounter({
    ...defaults,
    ...defaults.primary,
    provider: "openai-compatible",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-flash-2026-07-15",
  });
  const lines = Array.from({ length: 1200 }, (_, event) =>
    JSON.stringify({
      event,
      role: event % 2 ? "assistant" : "user",
      text: `결정 ${event}: PostgreSQL 사용. SELECT id FROM sources WHERE workspace_id = $1; <|endoftext|>`,
    }),
  );
  const text = lines.join("\n"),
    budget = 21000;
  const chunks = planChunks(text, budget, counter.count);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.length < planChunks(text, budget).length);
  assert.equal(chunks[0].start, 1);
  assert.equal(chunks.at(-1)?.end, lines.length);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (i) assert.equal(chunk.start, chunks[i - 1].end + 1);
    const body = lines.slice(chunk.start - 1, chunk.end).join("\n");
    const assembled = JSON.stringify({
      source: { start: chunk.start, end: chunk.end, text: body },
    });
    assert.ok(counter.count(assembled) + 3500 <= 25000);
    if (i < chunks.length - 1) assert.ok(counter.count(assembled) > 18000);
  }
  assert.ok(counter.count(text) < estimateTokens(text));
  // Providers without a recommended tokenizer keep the byte upper bound.
  const other = await inputTokenCounter({
    ...defaults,
    ...defaults.primary,
    provider: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
  });
  assert.equal(other.count(text), estimateTokens(text));
  assert.equal(other.version, "utf8-upper-bound-1");
  const deepseek = await inputTokenCounter({
    ...defaults,
    ...defaults.primary,
    provider: "openai-compatible",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "deepseek-v4-flash",
  });
  assert.equal(deepseek.version, "o200k-estimate-margin10-1");
  assert.equal(deepseek.count(text), counter.count(text));
  assert.ok(deepseek.count(text) < estimateTokens(text) / 2);
});
