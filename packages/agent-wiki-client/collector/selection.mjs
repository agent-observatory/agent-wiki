import { createHash } from "node:crypto";
export const SELECTION_VERSION = "conversation-1";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fields = [
  "type",
  "role",
  "content",
  "call_id",
  "name",
  "namespace",
  "arguments",
  "input",
  "output",
];
function content(value) {
  if (!Array.isArray(value)) return value;
  return value
    .filter((x) => !["thinking", "redacted_thinking"].includes(x?.type))
    .map((x) => {
      if (["text", "input_text", "output_text"].includes(x?.type))
        return { type: x.type, text: x.text };
      if (x?.type === "tool_result")
        return { ...x, content: content(x.content) };
      return x;
    });
}
function itemOf(value) {
  if (!value || typeof value !== "object") return null;
  const type = value.type ?? (value.role ? "message" : null);
  if (type === "message" && !["user", "assistant", "tool"].includes(value.role))
    return null;
  if (
    ![
      "message",
      "function_call",
      "custom_tool_call",
      "function_call_output",
      "custom_tool_call_output",
      "agent_message",
    ].includes(type)
  )
    return null;
  const item = Object.fromEntries(
    fields.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
  );
  item.type = type;
  if (item.content !== undefined) item.content = content(item.content);
  if (type === "agent_message") {
    item.role = "assistant";
    item.type = "message";
  }
  return item;
}
// Replayed prefix builds only fingerprints. No durable dedup state is advanced
// until the server acknowledges the raw byte cursor. Identical new utterances
// without native IDs are retained; snapshot copies are not new utterances.
export function createSelector(client) {
  const native = new Set(),
    occurrences = new Map();
  const stats = {
    selected: 0,
    messages: 0,
    toolCalls: 0,
    toolResults: 0,
    snapshotRecovered: 0,
    excluded: 0,
  };
  function select(event, position, active = true) {
    const out = [];
    const snapshotOccurrences = new Map();
    function add(value, snapshot = false) {
      const item = itemOf(value);
      if (!item) return;
      const hash = digest(item),
        nativeKey = value.id ?? value.uuid;
      const key = nativeKey ? String(nativeKey) + ":" + hash : null;
      if (snapshot) {
        const n = (snapshotOccurrences.get(hash) ?? 0) + 1;
        snapshotOccurrences.set(hash, n);
        if ((occurrences.get(hash) ?? 0) >= n) return;
      }
      if (key && native.has(key)) return;
      if (key) native.add(key);
      const occurrence = (occurrences.get(hash) ?? 0) + 1;
      occurrences.set(hash, occurrence);
      if (!active) return;
      out.push({
        id: key ? digest(key) : digest([hash, occurrence]),
        type: "response_item",
        payload: item,
        provenance: {
          client,
          event: position,
          kind: snapshot ? "compaction_recovered" : (event.type ?? "message"),
        },
        ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      });
      stats.selected++;
      if (item.type === "message") stats.messages++;
      else if (item.type.endsWith("_output")) stats.toolResults++;
      else stats.toolCalls++;
      if (snapshot) stats.snapshotRecovered++;
    }
    if (client === "codex" && event.type === "response_item")
      add(event.payload);
    else if (client === "codex" && event.type === "compacted") {
      for (const item of event.payload?.replacement_history ?? [])
        add(item, true);
      // A summary is only fallback context when there is no preserved history.
      if (
        !event.payload?.replacement_history?.length &&
        typeof event.payload?.message === "string"
      )
        add(
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: event.payload.message }],
          },
          true,
        );
    } else if (
      client === "claude" &&
      ["user", "assistant"].includes(event.type)
    )
      add({ ...event.message, role: event.type, id: event.uuid });
    else if (!event.type && (event.role || typeof event.text === "string"))
      add({
        type: "message",
        id: event.id ?? event.uuid,
        role: event.role ?? "user",
        content:
          event.content ??
          (event.image
            ? [
                { type: "input_text", text: event.text ?? "" },
                { type: "input_image", image_url: event.image },
              ]
            : event.text),
      });
    if (active && !out.length) stats.excluded++;
    return out;
  }
  return { select, stats };
}
