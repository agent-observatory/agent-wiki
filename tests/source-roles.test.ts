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
test("compacted history keeps each nested author separate and missing roles unknown", () => {
  const path = (n: number, ...rest: unknown[]) => [
    "payload",
    "replacement_history",
    n,
    ...rest,
  ];
  const roles = sourceRoles(
    [
      line(1, path(0, "role"), "user"),
      line(1, path(0, "content", 0, "text"), "PostgreSQL로 하자"),
      line(1, path(1, "role"), "assistant"),
      line(1, path(1, "content", 0, "text"), "설치 완료"),
      line(1, path(2, "content", 0, "text"), "역할 필드가 다른 조각에 있음"),
      line(1, ["payload", "summary"], "요약은 사용자 발언이 아님"),
      line(1, path(3, "role"), "system"),
      line(1, path(3, "content", 0, "text"), "사용자 권한 없음"),
    ].join("\n"),
  );
  assert.deepEqual(roles, [
    "user",
    "user",
    "assistant",
    "assistant",
    "unknown",
    "unknown",
    "unknown",
    "unknown",
  ]);
});
test("Codex item wrappers identify messages and observed command output only", () => {
  assert.deepEqual(
    sourceRoles(
      [
        line(1, ["payload", "type"], "item_completed"),
        line(1, ["payload", "item", "type"], "UserMessage"),
        line(1, ["payload", "item", "content", 0, "text"], "선택한 구성"),
        line(2, ["payload", "item", "type"], "AgentMessage"),
        line(2, ["payload", "item", "content", 0, "text"], "완료 주장"),
        line(3, ["payload", "item", "type"], "CommandExecution"),
        line(3, ["payload", "item", "command"], "echo requested"),
        line(3, ["payload", "item", "stdout"], "observed result"),
        line(4, ["payload", "type"], "custom_tool_call_output"),
        line(4, ["payload", "output", 0, "text"], "tool result"),
      ].join("\n"),
    ),
    [
      "unknown",
      "user",
      "user",
      "assistant",
      "assistant",
      "unknown",
      "unknown",
      "tool",
      "tool",
      "tool",
    ],
  );
});
