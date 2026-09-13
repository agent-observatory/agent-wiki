import { test } from "node:test";
import assert from "node:assert/strict";
import { createSelector } from "../packages/agent-wiki-client/collector/selection.mjs";
const message = (text, id) => ({
  type: "message",
  id,
  role: "user",
  content: [{ type: "input_text", text }],
});
const response = (payload) => ({ type: "response_item", payload });
test("selection keeps dialogue and exact tool output, omits telemetry, instructions and mirrored UI records", () => {
  const s = createSelector("codex");
  assert.equal(
    s.select({ type: "session_meta", payload: { cwd: "/test" } }, 0).length,
    0,
  );
  assert.equal(
    s.select(
      response({ ...message("private instructions"), role: "developer" }),
      1,
    ).length,
    0,
  );
  assert.equal(
    s.select(
      {
        type: "event_msg",
        payload: { type: "item_completed", item: { type: "UserMessage" } },
      },
      2,
    ).length,
    0,
  );
  assert.equal(
    s.select(response({ type: "reasoning", encrypted_content: "opaque" }), 3)
      .length,
    0,
  );
  const call = s.select(
    response({
      type: "function_call",
      call_id: "call1",
      name: "exec",
      arguments: '{"command":"test"}',
    }),
    4,
  )[0];
  const result = s.select(
    response({
      type: "function_call_output",
      call_id: "call1",
      output: "failure\nobserved result",
    }),
    5,
  )[0];
  assert.equal(call.payload.call_id, result.payload.call_id);
  assert.equal(result.payload.output, "failure\nobserved result");
  assert.equal(s.stats.selected, 2);
});
test("compaction snapshots do not replay original decisions, but recover otherwise missing context", () => {
  const s = createSelector("codex");
  const a = message("Use A", "a"),
    b = message("Cancel A, use B", "b");
  const saved = s.select(response(a), 0)[0];
  const recovered = s.select(
    { type: "compacted", payload: { replacement_history: [a, b] } },
    1,
  );
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].payload.content[0].text, "Cancel A, use B");
  assert.equal(recovered[0].provenance.kind, "compaction_recovered");
  assert.equal(
    s.select({ type: "compacted", payload: { replacement_history: [a, b] } }, 2)
      .length,
    0,
  );
  assert.notEqual(saved.id, recovered[0].id);
});
test("prefix replay is restart safe and retains genuinely repeated anonymous utterances", () => {
  const a = response(message("yes"));
  const s = createSelector("codex");
  const first = s.select(a, 0)[0],
    second = s.select(a, 1)[0];
  assert.notEqual(first.id, second.id);
  const retry = createSelector("codex");
  assert.equal(retry.select(a, 0, false).length, 0);
  assert.equal(retry.select(a, 1)[0].id, second.id);
  assert.equal(
    retry.select(
      { type: "compacted", payload: { replacement_history: [a.payload] } },
      2,
    ).length,
    0,
  );
});
test("Claude preserves messages and tool blocks without internal thinking", () => {
  const s = createSelector("claude");
  const out = s.select(
    {
      type: "assistant",
      uuid: "m1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: "result" },
          { type: "tool_use", id: "t1", name: "read", input: { path: "a" } },
        ],
      },
    },
    0,
  )[0];
  assert.equal(out.payload.content.length, 2);
  assert.equal(out.payload.content[1].id, "t1");
});

test("missing repeated anonymous utterances in a snapshot retain their multiplicity", () => {
  const s = createSelector("codex");
  const a = message("yes");
  s.select(response(a), 0);
  assert.equal(
    s.select({ type: "compacted", payload: { replacement_history: [a, a] } }, 1)
      .length,
    1,
  );
  assert.equal(
    s.select({ type: "compacted", payload: { replacement_history: [a, a] } }, 2)
      .length,
    0,
  );
});
