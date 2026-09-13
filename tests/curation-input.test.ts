import { test } from "node:test";
import assert from "node:assert/strict";
import {
  curationInput,
  touchesOmitted,
} from "../packages/core/src/curation-input.js";
const row = (path: unknown[], text: string) =>
  JSON.stringify({ event: 1, field: JSON.stringify(path), text });
test("known runtime fields are omitted without renumbering or changing evidence lines", () => {
  const lines = [
    row(["payload", "role"], "user"),
    row(["payload", "encrypted_content"], "opaque"),
    row(["payload", "state", "host_skills", "body"], "runtime instructions"),
    row(["payload", "content", 0, "text"], "PostgreSQL을 사용하자"),
  ];
  const p = curationInput(lines.join("\n"));
  assert.deepEqual(p.text.split("\n"), [lines[0], "", "", lines[3]]);
  assert.deepEqual(p.omitted, [
    { start: 2, end: 2, reason: "encrypted" },
    { start: 3, end: 3, reason: "agent_instructions" },
  ]);
  assert.equal(touchesOmitted([1, 4], p.omitted), true);
  assert.equal(touchesOmitted([4, 4], p.omitted), false);
  assert.equal(p.omittedBytes, Buffer.byteLength(lines[1] + lines[2]));
});
test("unknown fields, snapshots and quoted instruction names stay intact", () => {
  const text = [
    row(["payload", "content", 0, "text"], "encrypted_content를 제거하자"),
    row(
      ["payload", "replacement_history", 0, "content", 0, "text"],
      "과거 결정",
    ),
    row(["some", "developer_instructions"], "알 수 없는 자료"),
    "ordinary text",
  ].join("\n");
  assert.deepEqual(curationInput(text), { text, omitted: [], omittedBytes: 0 });
});
test("session metadata and split base instructions are not knowledge input", () => {
  const event = (id: number, path: unknown[], text: string) =>
    JSON.stringify({ event: id, field: JSON.stringify(path), text });
  const lines = [
    event(0, ["payload", "cwd"], "/personal/project"),
    event(0, ["type"], "session_meta"),
    event(0, ["payload", "agent_nickname"], "Socrates"),
    event(
      1,
      ["payload", "content", 0, "text"],
      "session_meta도 원문에는 보존하자",
    ),
    event(
      2,
      ["payload", "base_instructions", "text"],
      "split runtime instructions",
    ),
    event(3, ["payload", "cwd"], "unknown event must stay"),
  ];
  const p = curationInput(lines.join("\n"));
  assert.deepEqual(p.text.split("\n"), ["", "", "", lines[3], "", lines[5]]);
  assert.equal(touchesOmitted([1, 3], p.omitted), true);
  assert.equal(touchesOmitted([4, 4], p.omitted), false);
  assert.deepEqual(p.omitted, [
    { start: 1, end: 3, reason: "session_metadata" },
    { start: 5, end: 5, reason: "agent_instructions" },
  ]);
});

test("explicit developer/system messages are omitted, including nested snapshots, but user quotations and unknown roles remain", () => {
  const field = (event: number, path: unknown[], text: string) =>
    JSON.stringify({ event, field: JSON.stringify(path), text });
  const lines = [
    field(
      2,
      ["payload", "content", 0, "text"],
      "runtime instruction fragment one",
    ),
    field(2, ["payload", "role"], "developer"),
    field(
      2,
      ["payload", "content", 0, "text"],
      "runtime instruction fragment two",
    ),
    field(3, ["payload", "role"], "user"),
    field(
      3,
      ["payload", "content", 0, "text"],
      "developer 지침에 관해 질문할게",
    ),
    field(4, ["payload", "replacement_history", 0, "role"], "system"),
    field(
      4,
      ["payload", "replacement_history", 0, "content", 0, "text"],
      "nested instruction",
    ),
    field(4, ["payload", "replacement_history", 1, "role"], "user"),
    field(
      4,
      ["payload", "replacement_history", 1, "content", 0, "text"],
      "지침 필터를 고치자",
    ),
    field(5, ["payload", "content", 0, "text"], "unknown author retained"),
  ];
  const result = curationInput(lines.join("\n"));
  assert.deepEqual(result.text.split("\n"), [
    "",
    "",
    "",
    lines[3],
    lines[4],
    "",
    "",
    lines[7],
    lines[8],
    lines[9],
  ]);
  assert.deepEqual(result.omitted, [
    { start: 1, end: 3, reason: "agent_instructions" },
    { start: 6, end: 7, reason: "agent_instructions" },
  ]);
});
