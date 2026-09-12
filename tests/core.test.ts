import { test } from "node:test";
import assert from "node:assert/strict";
import { mask } from "../packages/core/src/storage.js";
import { parseExtraction } from "../packages/core/src/ingest.js";
test("masks common credentials before persistence", () => {
  const source = "api_key=synthetic-secret\nkeep this decision";
  assert.equal(mask(source), "api_key=[REDACTED]\nkeep this decision");
});
test("rejects invented evidence and invalid decision states", () => {
  assert.throws(() =>
    parseExtraction(
      JSON.stringify({
        title: "a",
        summary: "b",
        tags: [],
        memories: [{ claim: "c", quote: "made up", status: "user_confirmed" }],
      }),
      "actual source",
    ),
  );
  assert.throws(() =>
    parseExtraction(
      JSON.stringify({
        title: "a",
        summary: "b",
        tags: [],
        memories: [{ claim: "c", quote: "actual", status: "implemented" }],
      }),
      "actual source",
    ),
  );
});
