import { test } from "node:test";
import assert from "node:assert/strict";
import { mask } from "../packages/core/src/storage.js";
test("masks common credentials before persistence", () => {
  const source = "api_key=synthetic-secret\nkeep this decision";
  assert.equal(mask(source), "api_key=[REDACTED]\nkeep this decision");
});
