// Read transport structure, never a role mentioned inside message text.
export type SourceRole = "user" | "assistant" | "tool" | "unknown";
export function sourceRoles(text: string): SourceRole[] {
  const rows = text.split("\n").map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  });
  const roles = new Map<unknown, SourceRole>(),
    tools = new Map<unknown, string[]>();
  for (const row of rows) {
    if (!row || row.event === undefined || typeof row.field !== "string")
      continue;
    let path: unknown;
    try {
      path = JSON.parse(row.field);
    } catch {
      continue;
    }
    if (!Array.isArray(path)) continue;
    let role: SourceRole | undefined;
    if (
      ['["role"]', '["payload","role"]', '["message","role"]'].includes(
        JSON.stringify(path),
      ) &&
      ["user", "assistant", "tool"].includes(row.text)
    )
      role = row.text;
    if (['["type"]', '["payload","type"]'].includes(JSON.stringify(path))) {
      if (["user", "user_message"].includes(row.text)) role = "user";
      if (["assistant", "agent_message"].includes(row.text)) role = "assistant";
      if (["function_call_output", "tool_result"].includes(row.text))
        role = "tool";
    }
    if (role) {
      const previous = roles.get(row.event);
      roles.set(row.event, previous && previous !== role ? "unknown" : role);
    }
    if (path.at(-1) === "type" && row.text === "tool_result") {
      const prefix = path.slice(0, -1);
      if (
        (prefix.length === 2 && prefix[0] === "content") ||
        (prefix.length === 3 &&
          ["message", "payload"].includes(prefix[0]) &&
          prefix[1] === "content")
      )
        tools.set(row.event, [
          ...(tools.get(row.event) ?? []),
          JSON.stringify(prefix),
        ]);
    }
  }
  return rows.map((row) => {
    if (!row) return "unknown";
    if (row.event !== undefined && typeof row.field === "string") {
      let path;
      try {
        path = JSON.parse(row.field);
      } catch {
        return "unknown";
      }
      if (
        Array.isArray(path) &&
        (tools.get(row.event) ?? []).some(
          (prefix) =>
            JSON.stringify(path.slice(0, JSON.parse(prefix).length)) === prefix,
        )
      )
        return "tool";
      return roles.get(row.event) ?? "unknown";
    }
    return "unknown";
  });
}
export function roleRanges(roles: SourceRole[], start: number, end: number) {
  const ranges: { start: number; end: number; role: SourceRole }[] = [];
  for (let line = start; line <= end; line++) {
    const role = roles[line - 1] ?? "unknown",
      last = ranges.at(-1);
    if (last?.role === role) last.end = line;
    else ranges.push({ start: line, end: line, role });
  }
  return ranges;
}
export function evidenceHasRole(
  evidence: { lines: [number, number] }[],
  ranges: ReturnType<typeof roleRanges>,
  allowed: SourceRole[],
) {
  return (
    evidence.length > 0 &&
    evidence.every(
      (e) =>
        e.lines[0] <= e.lines[1] &&
        Array.from(
          { length: e.lines[1] - e.lines[0] + 1 },
          (_, i) => e.lines[0] + i,
        ).every((line) =>
          allowed.includes(
            ranges.find((r) => line >= r.start && line <= r.end)?.role ??
              "unknown",
          ),
        ),
    )
  );
}
