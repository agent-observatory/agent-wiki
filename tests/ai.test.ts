import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callModel,
  defaults,
  aiConfig,
  ModelError,
  parseRetryAfter,
} from "../packages/core/src/ai.js";
test("NVIDIA pending responses poll the same request without resubmitting inference", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  let reservations = 0;
  const observations: any[] = [];
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
      async () => {
        reservations++;
      },
      (event) => observations.push(event),
    );
    assert.deepEqual(r.output, { changes: [] });
    assert.equal(urls.length, 2);
    assert.equal(reservations, 1);
    assert.deepEqual(
      observations.map((e) => e.type),
      ["response", "poll", "response", "usage"],
    );
    assert.deepEqual(
      observations.filter((e) => e.type === "response").map((e) => e.status),
      [202, 200],
    );
    assert.ok(urls[1].endsWith("/status/12345678-1234-1234-1234-123456789abc"));
  } finally {
    globalThis.fetch = original;
  }
});
test("provider rate limiting respects the provider retry delay and does not expose response bodies", async () => {
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
        e.retryAfter === 99999 &&
        !e.message.includes("synthetic-secret"),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("Retry-After accepts seconds and HTTP dates without shortening provider cooldowns", () => {
  const now = Date.UTC(2026, 8, 13);
  assert.equal(parseRetryAfter("120", now), 120);
  assert.equal(parseRetryAfter(new Date(now + 90000).toUTCString(), now), 90);
  assert.equal(parseRetryAfter(new Date(now - 90000).toUTCString(), now), 0);
  assert.equal(parseRetryAfter("invalid", now), 60);
});

test("invalid model JSON still reports HTTP success and consumed tokens without leaking output", async () => {
  const original = globalThis.fetch;
  const observations: any[] = [];
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "synthetic-private-output" },
          },
        ],
        usage: { total_tokens: 91 },
      }),
    );
  try {
    await assert.rejects(
      callModel(
        defaults,
        "synthetic",
        [],
        AbortSignal.timeout(1000),
        undefined,
        (event) => observations.push(event),
      ),
      (e: any) => e.code === "AI_INVALID_JSON",
    );
    assert.deepEqual(observations, [
      { type: "response", status: 200 },
      { type: "usage", usage: { total_tokens: 91 } },
    ]);
    assert.ok(!JSON.stringify(observations).includes("private-output"));
  } finally {
    globalThis.fetch = original;
  }
});

test("daily limit is optional and explicit limits remain positive bounded integers", () => {
  assert.equal(defaults.dailyCalls, null);
  assert.equal(aiConfig.parse({ dailyCalls: null }).dailyCalls, null);
  assert.equal(aiConfig.parse({ dailyCalls: 24 }).dailyCalls, 24);
  for (const dailyCalls of [0, -1, 1.5, 1001, "unlimited"])
    assert.equal(aiConfig.safeParse({ dailyCalls }).success, false);
});
