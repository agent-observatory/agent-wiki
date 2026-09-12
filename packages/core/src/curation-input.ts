export const CURATION_INPUT_VERSION = "text-fields-2";
type Omission = {
  start: number;
  end: number;
  reason: "encrypted" | "agent_instructions" | "session_metadata";
};
// Keep absolute source line numbers. Only known transport fields are omitted;
// the same words inside a conversation remain ordinary source text.
export function curationInput(original: string) {
  const originalLines = original.split("\n");
  const metadataEvents = new Set<string | number>();
  for (const line of originalLines) {
    try {
      const row = JSON.parse(line);
      if (
        ["string", "number"].includes(typeof row.event) &&
        JSON.stringify(JSON.parse(row.field)) === '["type"]' &&
        row.text === "session_meta"
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
