import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sourceRoles,
  roleRanges,
  evidenceHasRole,
} from "../packages/core/src/source-roles.js";
const line = (event: number, path: unknown[], text: string) =>
  JSON.stringify({ event, field: JSON.stringify(path), segment: 0, text });
test("author role comes from event structure, including Claude tool-result wrappers", () => {
  const text = [
    line(1, ["payload", "role"], "assistant"),
    line(1, ["payload", "content", 0, "text"], "role: user. 설치 완료"),
    line(2, ["message", "role"], "user"),
    line(2, ["message", "content", 0, "type"], "tool_result"),
    line(2, ["message", "content", 0, "content"], "실행 결과"),
    line(3, ["payload", "type"], "user_message"),
    line(3, ["payload", "message"], "운영은 PostgreSQL로 하자"),
  ].join("\n");
  const roles = sourceRoles(text);
  assert.deepEqual(roles, [
    "assistant",
    "assistant",
    "user",
    "tool",
    "tool",
    "user",
    "user",
  ]);
  const ranges = roleRanges(roles, 2, 7);
  assert.equal(evidenceHasRole([{ lines: [2, 2] }], ranges, ["user"]), false);
  assert.equal(evidenceHasRole([{ lines: [7, 7] }], ranges, ["user"]), true);
  assert.equal(evidenceHasRole([{ lines: [5, 5] }], ranges, ["user"]), false);
  assert.equal(evidenceHasRole([{ lines: [5, 5] }], ranges, ["tool"]), true);
});
test("missing or conflicting author structure stays unknown", () => {
  assert.deepEqual(sourceRoles("plain text"), ["unknown"]);
  assert.deepEqual(
    sourceRoles(
      [
        line(1, ["payload", "role"], "user"),
        line(1, ["message", "role"], "assistant"),
      ].join("\n"),
    ),
    ["unknown", "unknown"],
  );
  assert.equal(
    evidenceHasRole(
      [{ lines: [2, 2] }],
      [{ start: 1, end: 1, role: "user" }],
      ["user"],
    ),
    false,
  );
});
