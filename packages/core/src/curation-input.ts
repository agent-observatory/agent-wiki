export const CURATION_INPUT_VERSION = "text-fields-5";
type Omission = {
  start: number;
  end: number;
  reason:
    | "encrypted"
    | "agent_instructions"
    | "session_metadata"
    | "wiki_echo";
};
// The wiki reading itself back. An agent that runs the Wiki CLI gets wiki
// content in its tool output; that output is collected as L1, extracted as
// observations, and returns as knowledge — 87% of current claims once came
// from the single session that built this wiki. The role gate cannot catch it:
// tool output is exactly what a legitimate observation cites, and `kubectl get
// pods` and `agent-wiki pages` are both tool output. So cut the loop at the
// one place it is decidable — the command that produced it.
const WIKI_COMMAND = /(^|[\s;&|/])agent-wiki(\s|$)|agent-wiki\.mjs/;
// A tool named for the wiki rather than a shell command that runs it.
const WIKI_TOOL_NAME = /(^|_)agent[-_]wiki(_|$)/;
// The path up to and including its last array index: one tool call or one
// result block, so a command can be matched with the id sitting beside it.
function containerPrefix(path: unknown[]) {
  for (let i = path.length - 1; i >= 0; i--)
    if (typeof path[i] === "number") return path.slice(0, i + 1);
  return path.slice(0, 1);
}
// Every call id whose command ran the Wiki CLI.
function wikiCallIds(originalLines: string[]) {
  const fields = new Map<string, Map<string, string>>();
  for (const line of originalLines) {
    try {
      const row = JSON.parse(line),
        path = JSON.parse(row.field);
      if (!["string", "number"].includes(typeof row.event) || !Array.isArray(path))
        continue;
      if (typeof row.text !== "string") continue;
      const prefix = containerPrefix(path);
      const key = JSON.stringify([row.event, prefix]);
      const own = fields.get(key) ?? new Map<string, string>();
      own.set(JSON.stringify(path.slice(prefix.length)), row.text);
      fields.set(key, own);
    } catch {}
  }
  const ids = new Set<string>();
  for (const own of fields.values()) {
    const ran = [...own.entries()].some(
      ([relative, text]) =>
        (['["input","command"]', '["arguments"]', '["input","cmd"]'].includes(
          relative,
        ) &&
          WIKI_COMMAND.test(text)) ||
        (['["name"]', '["payload","name"]'].includes(relative) &&
          WIKI_TOOL_NAME.test(text)),
    );
    if (!ran) continue;
    for (const name of ['["id"]', '["call_id"]', '["tool_use_id"]']) {
      const id = own.get(name);
      if (id) ids.add(id);
    }
  }
  return ids;
}
function messageScope(path: unknown[]) {
  if (
    path[0] === "payload" &&
    path[1] === "replacement_history" &&
    typeof path[2] === "number"
  )
    return path.slice(0, 3);
  if (path[0] === "payload" && path[1] === "item") return path.slice(0, 2);
  return [];
}
// Keep absolute source line numbers. Only known transport fields are omitted;
// the same words inside a conversation remain ordinary source text.
export function curationInput(original: string) {
  const originalLines = original.split("\n");
  const metadataEvents = new Set<string | number>();
  const messageRoles = new Map<string, Set<string>>();
  for (const line of originalLines) {
    try {
      const row = JSON.parse(line),
        path = JSON.parse(row.field);
      if (
        ["string", "number"].includes(typeof row.event) &&
        Array.isArray(path)
      ) {
        const scope = messageScope(path),
          rolePath = JSON.stringify(path.slice(scope.length));
        if (
          ['["role"]', '["payload","role"]', '["message","role"]'].includes(
            rolePath,
          ) &&
          typeof row.text === "string"
        ) {
          const id = JSON.stringify([row.event, scope]);
          const roles = messageRoles.get(id) ?? new Set<string>();
          roles.add(row.text);
          messageRoles.set(id, roles);
        }
      }
      if (
        ["string", "number"].includes(typeof row.event) &&
        JSON.stringify(JSON.parse(row.field)) === '["type"]' &&
        ["session_meta", "lineage"].includes(row.text)
      )
        metadataEvents.add(row.event);
    } catch {}
  }
  const echoIds = wikiCallIds(originalLines);
  // Both sides of a wiki call: the command line and the block that carries its
  // output. A container is identified by the same id on either side.
  const echoContainers = new Set<string>();
  if (echoIds.size)
    for (const line of originalLines) {
      try {
        const row = JSON.parse(line),
          path = JSON.parse(row.field);
        if (typeof row.text !== "string" || !Array.isArray(path)) continue;
        const relative = JSON.stringify(path.slice(containerPrefix(path).length));
        if (
          ['["id"]', '["call_id"]', '["tool_use_id"]'].includes(relative) &&
          echoIds.has(row.text)
        )
          echoContainers.add(
            JSON.stringify([row.event, containerPrefix(path)]),
          );
      } catch {}
    }
  const omitted: Omission[] = [];
  let omittedBytes = 0;
  const lines = originalLines.map((line, index) => {
    let reason: Omission["reason"] | undefined;
    try {
      const row = JSON.parse(line),
        path = JSON.parse(row.field);
      if (
        !["string", "number"].includes(typeof row.event) ||
        !Array.isArray(path)
      )
        return line;
      const key = JSON.stringify(path);
      const roles = messageRoles.get(
        JSON.stringify([row.event, messageScope(path)]),
      );
      if (roles?.size === 1 && (roles.has("developer") || roles.has("system")))
        reason = "agent_instructions";
      if (["provenance", "id"].includes(path[0])) reason = "session_metadata";
      if (metadataEvents.has(row.event)) reason = "session_metadata";
      if (key === '["payload","encrypted_content"]') reason = "encrypted";
      // Match any ancestor, not just this line's own container: a tool result
      // whose content is an array of blocks sits one level deeper than the
      // tool_use_id that identifies it, and checking only the exact container
      // left the wiki's answer in the input.
      if (
        path.some((_: unknown, i: number) =>
          echoContainers.has(JSON.stringify([row.event, path.slice(0, i + 1)])),
        )
      )
        reason = "wiki_echo";
      if (
        key === '["payload","base_instructions","text"]' ||
        key === '["payload","state","host_skills","body"]' ||
        key === '["payload","developer_instructions"]' ||
        key ===
          '["payload","thread_settings","collaboration_mode","settings","developer_instructions"]'
      )
        reason = "agent_instructions";
    } catch {}
    if (!reason) return line;
    omittedBytes += Buffer.byteLength(line);
    const last = omitted.at(-1),
      number = index + 1;
    if (last?.end === number - 1 && last.reason === reason) last.end = number;
    else omitted.push({ start: number, end: number, reason });
    return "";
  });
  return { text: lines.join("\n"), omitted, omittedBytes };
}
export function touchesOmitted(lines: [number, number], omitted: Omission[]) {
  return omitted.some((r) => lines[0] <= r.end && lines[1] >= r.start);
}
