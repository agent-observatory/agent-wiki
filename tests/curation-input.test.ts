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

// The wiki reading itself back. An agent that runs the Wiki CLI gets wiki
// content in its tool output, that output is collected as L1, extracted as an
// observation, and returns as knowledge: 87% of current claims once came from
// the single session that built this wiki. The role gate cannot catch it —
// tool output is exactly what a legitimate observation cites — so the loop is
// cut at the command that produced it.
test("wiki CLI output is omitted from curation input; other tool output is not", () => {
  const row = (event: number, field: (string | number)[], text: string) =>
    JSON.stringify({ event, field: JSON.stringify(field), text });
  const wikiContent = "주장 5개 · K3s는 OCI VM 한 대에서 돈다";
  const lines = [
    row(1, ["payload", "content", 0, "type"], "tool_use"),
    row(1, ["payload", "content", 0, "id"], "call-wiki"),
    row(
      1,
      ["payload", "content", 0, "input", "command"],
      "agent-wiki review conflicts",
    ),
    row(2, ["payload", "content", 0, "type"], "tool_result"),
    row(2, ["payload", "content", 0, "tool_use_id"], "call-wiki"),
    row(2, ["payload", "content", 0, "content"], wikiContent),
    row(3, ["payload", "content", 0, "type"], "tool_use"),
    row(3, ["payload", "content", 0, "id"], "call-kube"),
    row(3, ["payload", "content", 0, "input", "command"], "kubectl get pods"),
    row(4, ["payload", "content", 0, "type"], "tool_result"),
    row(4, ["payload", "content", 0, "tool_use_id"], "call-kube"),
    row(4, ["payload", "content", 0, "content"], "agent-wiki-worker Running"),
  ];
  const result = curationInput(lines.join("\n"));
  assert.ok(
    !result.text.includes(wikiContent),
    "the wiki's own answer never reaches the model",
  );
  assert.ok(
    result.text.includes("agent-wiki-worker Running"),
    "a real observation is kept even when the wiki's name appears in it",
  );
  assert.deepEqual(result.omitted, [{ start: 1, end: 6, reason: "wiki_echo" }]);
  assert.equal(
    result.text.split("\n").length,
    lines.length,
    "absolute line numbers are preserved",
  );
});

// The Codex shape pairs on call_id instead of tool_use_id.
test("a Codex function call to the Wiki CLI is omitted the same way", () => {
  const row = (event: number, field: (string | number)[], text: string) =>
    JSON.stringify({ event, field: JSON.stringify(field), text });
  const lines = [
    row(1, ["payload", "type"], "function_call"),
    row(1, ["payload", "call_id"], "c1"),
    row(
      1,
      ["payload", "arguments"],
      '{"command":["bash","-lc","node packages/agent-wiki-client/cli/agent-wiki.mjs pages"]}',
    ),
    row(2, ["payload", "type"], "function_call_output"),
    row(2, ["payload", "call_id"], "c1"),
    row(2, ["payload", "output"], "지식 목록 14개"),
  ];
  const result = curationInput(lines.join("\n"));
  assert.ok(!result.text.includes("지식 목록 14개"));
  assert.deepEqual(result.omitted, [{ start: 1, end: 6, reason: "wiki_echo" }]);
});

// The realistic Claude shape: a tool result whose content is an array of
// blocks. Those lines sit one level deeper than the tool_use_id that
// identifies the call, so matching only the exact container left the wiki's
// own answer in the model input — the thing the gate exists to remove.
test("wiki output nested in result blocks is omitted, and a named wiki tool too", () => {
  const row = (event: number, field: (string | number)[], text: string) =>
    JSON.stringify({ event, field: JSON.stringify(field), text });
  const nested = curationInput(
    [
      row(1, ["payload", "content", 0, "type"], "tool_use"),
      row(1, ["payload", "content", 0, "id"], "c1"),
      row(1, ["payload", "content", 0, "input", "command"], "agent-wiki pages"),
      row(2, ["payload", "content", 0, "tool_use_id"], "c1"),
      row(2, ["payload", "content", 0, "content", 0, "text"], "지식 목록 14개"),
    ].join("\n"),
  );
  assert.ok(!nested.text.includes("지식 목록 14개"));
  assert.deepEqual(nested.omitted, [{ start: 1, end: 5, reason: "wiki_echo" }]);

  const named = curationInput(
    [
      row(1, ["payload", "content", 0, "id"], "c2"),
      row(1, ["payload", "content", 0, "name"], "mcp__agent-wiki__search"),
      row(2, ["payload", "content", 0, "tool_use_id"], "c2"),
      row(2, ["payload", "content", 0, "content"], "주장 5개"),
    ].join("\n"),
  );
  assert.ok(!named.text.includes("주장 5개"));

  // Neither the wiki's name inside another tool's output nor a person talking
  // about the wiki is an echo.
  const kept = curationInput(
    [
      row(1, ["payload", "content", 0, "id"], "k1"),
      row(1, ["payload", "content", 0, "input", "command"], "kubectl get pods"),
      row(2, ["payload", "content", 0, "tool_use_id"], "k1"),
      row(2, ["payload", "content", 0, "content", 0, "text"], "agent-wiki-worker Running"),
      row(3, ["payload", "role"], "user"),
      row(3, ["payload", "content"], "agent-wiki 를 어떻게 쓰지"),
    ].join("\n"),
  );
  assert.deepEqual(kept.omitted, []);
});
