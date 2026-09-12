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
