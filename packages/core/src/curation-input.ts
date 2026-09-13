export const CURATION_INPUT_VERSION = "text-fields-4";
type Omission = {
  start: number;
  end: number;
  reason: "encrypted" | "agent_instructions" | "session_metadata";
};
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
