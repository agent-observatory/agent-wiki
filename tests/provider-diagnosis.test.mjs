import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  probe,
  probeNeedsCooldown,
} from "../experiments/curation/provider-diagnosis.mjs";

async function serverFor(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/chat/completions`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("probe separates a successful Hello from JSON output without recording content", async () => {
  await serverFor(
    (_req, res) =>
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: "Hello synthetic-private" },
              finish_reason: "stop",
            },
          ],
          usage: { total_tokens: 12 },
        }),
      ),
    async (url) => {
      const result = await probe(url, "synthetic", {
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 16384,
      });
      assert.equal(result.status, 200);
      assert.equal(result.complete, true);
      assert.equal(result.jsonValid, false);
      assert.equal(result.hasVisibleContent, true);
      assert.equal(result.finishReason, "stop");
      assert.equal(result.usage.total_tokens, 12);
      assert.ok(!JSON.stringify(result).includes("synthetic-private"));
    },
  );
});

test("streaming probe measures reasoning and visible content across fragmented UTF-8", async () => {
  await serverFor(
    (_req, res) => {
      res.setHeader("content-type", "text/event-stream");
      const payload =
        [
          {
            choices: [
              {
                delta: { reasoning_content: "private reasoning" },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              { delta: { content: '{"답":"값"}' }, finish_reason: null },
            ],
          },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { total_tokens: 23 },
          },
        ]
          .map((data) => "data: " + JSON.stringify(data) + "\n\n")
          .join("") + "data: [DONE]\n\n";
      const bytes = Buffer.from(payload);
      for (let i = 0; i < bytes.length; i += 7)
        res.write(bytes.subarray(i, i + 7));
      res.end();
    },
    async (url) => {
      const result = await probe(url, "synthetic", { stream: true });
      assert.equal(result.complete, true);
      assert.equal(result.jsonValid, true);
      assert.equal(result.contentChars, 9);
      assert.equal(result.reasoningChars, 17);
      assert.equal(result.usage.total_tokens, 23);
      assert.ok(result.firstContentMs >= result.headersMs);
      assert.ok(!JSON.stringify(result).includes("private reasoning"));
    },
  );
});

test("probe preserves output truncation, provider errors and caller timeouts as different outcomes", async () => {
  await serverFor(
    (_req, res) =>
      res.end(
        JSON.stringify({
          choices: [
            { message: { content: '{"partial":' }, finish_reason: "length" },
          ],
        }),
      ),
    async (url) => {
      const result = await probe(url, "synthetic", {});
      assert.equal(result.finishReason, "length");
      assert.equal(result.jsonValid, false);
      assert.equal(result.error, undefined);
    },
  );
  await serverFor(
    (_req, res) => {
      res.writeHead(504, { "retry-after": "120" });
      res.end("private failure body");
    },
    async (url) => {
      const result = await probe(url, "synthetic", {});
      assert.equal(result.error, "HTTP_504");
      assert.equal(result.retryAfter, "120");
      assert.ok(!JSON.stringify(result).includes("private failure body"));
    },
  );
  await serverFor(
    () => {},
    async (url) => {
      const result = await probe(url, "synthetic", {}, { timeoutMs: 30 });
      assert.equal(result.error, "CLIENT_TIMEOUT_OR_ABORT");
      assert.equal(result.status, undefined);
    },
  );
});

test("a stalled HTTP 200 stream still requires the shared retry cooldown", async () => {
  await serverFor(
    (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    },
    async (url) => {
      const result = await probe(
        url,
        "synthetic",
        { stream: true },
        { timeoutMs: 500 },
      );
      assert.equal(result.status, 200);
      assert.equal(result.complete, false);
      assert.equal(result.contentChars, 7);
      assert.equal(probeNeedsCooldown(result), true);
      assert.equal(probeNeedsCooldown({ status: 200, complete: true }), false);
      assert.equal(probeNeedsCooldown({ status: 401, complete: false }), false);
    },
  );
});
