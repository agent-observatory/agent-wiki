import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planChunks, estimateTokens } from "../packages/core/src/chunking.js";
import { projectEvents } from "../apps/agent-wiki-worker/src/ingest.js";
test("chunk coverage is complete and disjoint, preferring event boundaries and retaining earlier context on split events", () => {
  const lines = Array.from({ length: 50 }, (_, i) =>
    JSON.stringify({
      event: Math.floor(i / 10),
      text: "합성 내용 ".repeat(10),
    }),
  );
  const chunks = planChunks(lines.join("\n"), 1300);
  assert.equal(chunks[0].start, 1);
  assert.equal(chunks.at(-1)!.end, lines.length);
  chunks.forEach((c, i) => {
    if (i) assert.equal(c.start, chunks[i - 1].end + 1);
    assert.ok(
      estimateTokens(lines.slice(c.start - 1, c.end).join("\n")) <= 1300,
    );
  });
  assert.ok(chunks.some((c) => c.contextStart < c.start));
});
test("text projection preserves tool IDs and numeric facts, excludes image bytes and image URLs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-project-test-"));
  try {
    const input = JSON.stringify({
      role: "tool",
      call_id: "call-one",
      output: { count: 3, ok: false },
      content: [
        {
          type: "image_url",
          image_url: { url: "https://example.org/private-image.png" },
        },
        { type: "text", text: "텍스트 근거" },
      ],
      image: "data:image/png;base64," + "A".repeat(100000),
    });
    let count = 0;
    for await (const e of projectEvents(
      (async function* () {
        for (let i = 0; i < input.length; i += 53)
          yield Buffer.from(input.slice(i, i + 53));
      })(),
      dir,
    )) {
      count++;
      const text = await readFile(e.file, "utf8");
      assert.ok(!text.includes("AAAA"));
      assert.ok(!text.includes("private-image"));
      assert.ok(text.includes("call-one"));
      assert.ok(text.includes('"text":"3"'));
      assert.ok(text.includes('"text":"false"'));
      assert.ok(text.includes("텍스트 근거"));
    }
    assert.equal(count, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
