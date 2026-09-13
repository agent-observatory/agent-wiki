import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  probe,
  probeNeedsCooldown,
  readableModelInput,
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

test("probe assesses JSON in memory without including original output in returned metrics", async () => {
  await serverFor(
    (_req, res) =>
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  changes: [{ quote: "synthetic-private-quotation" }],
                }),
              },
              finish_reason: "stop",
            },
          ],
        }),
      ),
    async (url) => {
      let checked = 0;
      const result = await probe(
        url,
        "synthetic",
        {},
        {
          onOutput: (output) => {
            checked = output.changes.length;
          },
        },
      );
      assert.equal(checked, 1);
      assert.equal(result.jsonValid, true);
      assert.ok(
        !JSON.stringify(result).includes("synthetic-private-quotation"),
      );
      assert.equal(Object.hasOwn(result, "output"), false);
    },
  );
});

test("readable source records preserve absolute rows, original characters and the canonical input", () => {
  const row = {
    event: 3,
    field: '["payload","content",0,"text"]',
    text: '첫 줄\n  두 번째 줄 "인용"',
  };
  const input = {
    source: {
      id: "synthetic",
      revision: 1,
      start: 159,
      end: 161,
      text: JSON.stringify(row) + "\n\nplain line",
      roles: [{ start: 159, end: 159, role: "user" }],
    },
    related: [],
  };
  const before = structuredClone(input);
  const result = readableModelInput(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.source.records, [
    {
      line: 159,
      event: 3,
      field: ["payload", "content", 0, "text"],
      text: row.text,
    },
    { line: 160, text: "" },
    { line: 161, text: "plain line" },
  ]);
  assert.deepEqual(result.source.roles, input.source.roles);
  assert.equal("text" in result.source, false);
});
