import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectEvents } from "../packages/core/src/projection.js";
import { sourceRoles } from "../packages/core/src/source-roles.js";
// @ts-expect-error standalone client
import { createSelector } from "../packages/agent-wiki-client/collector/selection.mjs";
test("summary authority survives projection splits even without the wrapper role", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-derived-"));
  try {
    const selected = createSelector("claude").select(
      {
        type: "user",
        uuid: "summary",
        isCompactSummary: true,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call",
              content: "copied observation ".repeat(1000),
            },
          ],
        },
      },
      0,
    )[0];
    async function* bytes() {
      yield Buffer.from(JSON.stringify(selected) + "\n");
    }
    for await (const event of projectEvents(bytes(), dir)) {
      const rows = (await readFile(event.file, "utf8")).trim().split("\n");
      const payload = rows.filter(
        (row) => JSON.parse(JSON.parse(row).field)[0] === "payload",
      );
      assert.ok(payload.length > 10);
      assert.ok(
        sourceRoles(payload.join("\n")).every((role) => role === "unknown"),
      );
      for (const row of payload)
        assert.equal(JSON.parse(row).authority, "derived_context");
      assert.ok(
        sourceRoles(payload.slice(5).join("\n")).every(
          (role) => role === "unknown",
        ),
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
