import { test } from "node:test";
import assert from "node:assert/strict";
import { callModel, defaults, ModelError } from "../packages/core/src/ai.js";
test("NVIDIA pending responses poll the same request without resubmitting inference", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return urls.length === 1
      ? new Response(
          JSON.stringify({ requestId: "12345678-1234-1234-1234-123456789abc" }),
          { status: 202 },
        )
      : new Response(
          JSON.stringify({
            choices: [
              { finish_reason: "stop", message: { content: '{"changes":[]}' } },
            ],
            usage: { total_tokens: 4 },
          }),
        );
  };
  try {
    const r = await callModel(
      defaults,
      "synthetic",
      [],
      AbortSignal.timeout(5000),
    );
    assert.deepEqual(r.output, { changes: [] });
    assert.equal(urls.length, 2);
    assert.ok(urls[1].endsWith("/status/12345678-1234-1234-1234-123456789abc"));
  } finally {
    globalThis.fetch = original;
  }
});
test("provider rate limiting keeps a bounded retry delay and does not expose response bodies", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("synthetic-secret", {
      status: 429,
      headers: { "Retry-After": "99999" },
    });
  try {
    await assert.rejects(
      callModel(defaults, "synthetic", [], AbortSignal.timeout(1000)),
      (e: any) =>
        e instanceof ModelError &&
        e.code === "AI_HTTP_429" &&
        e.retryAfter === 3600 &&
        !e.message.includes("synthetic-secret"),
    );
  } finally {
    globalThis.fetch = original;
  }
});
