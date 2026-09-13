// Read transport structure, never a role mentioned inside message text.
export type SourceRole = "user" | "assistant" | "tool" | "unknown";
type Field = {
  event: string | number;
  path: (string | number)[];
  text: unknown;
  authority?: string;
};
function field(line: string): Field | null {
  try {
    const row = JSON.parse(line),
      path = JSON.parse(row.field);
    if (
      !["string", "number"].includes(typeof row.event) ||
      !Array.isArray(path) ||
      !path.every((p) => typeof p === "string" || typeof p === "number")
    )
      return null;
    return { event: row.event, path, text: row.text, authority: row.authority };
  } catch {
    return null;
  }
}
function scope(path: Field["path"]) {
  if (
    path[0] === "payload" &&
    path[1] === "replacement_history" &&
    typeof path[2] === "number"
  )
    return path.slice(0, 3);
  if (path[0] === "payload" && path[1] === "item") return path.slice(0, 2);
  return [];
}
export function sourceRoles(text: string): SourceRole[] {
  const rows = text.split("\n").map(field);
  const roles = new Map<string, SourceRole>(),
    tools = new Map<string, string[]>();
  const executions = new Set<string>();
  const derived = new Set<string | number>();
  const key = (row: Field) => JSON.stringify([row.event, scope(row.path)]);
  for (const row of rows) {
    if (!row) continue;
    if (
      ["provenance", "timestamp", "id"].includes(String(row.path[0])) &&
      row.path[1] === "authority" &&
      row.text === "derived_context"
    )
      derived.add(row.event);
    const id = key(row),
      path = row.path.slice(scope(row.path).length),
      encoded = JSON.stringify(path);
    let role: SourceRole | undefined;
    if (
      ['["role"]', '["payload","role"]', '["message","role"]'].includes(
        encoded,
      ) &&
      ["user", "assistant", "tool"].includes(String(row.text))
    )
      role = row.text as SourceRole;
    if (['["type"]', '["payload","type"]'].includes(encoded)) {
      if (["user", "user_message", "UserMessage"].includes(String(row.text)))
        role = "user";
      if (
        ["assistant", "agent_message", "AgentMessage", "Reasoning"].includes(
          String(row.text),
        )
      )
        role = "assistant";
      if (
        [
          "function_call_output",
          "custom_tool_call_output",
          "tool_result",
        ].includes(String(row.text))
      )
        role = "tool";
      if (row.path[1] === "item" && row.text === "CommandExecution")
        executions.add(id);
    }
    if (role) {
      const previous = roles.get(id);
      roles.set(id, previous && previous !== role ? "unknown" : role);
    }
    if (path.at(-1) === "type" && row.text === "tool_result") {
      const prefix = path.slice(0, -1);
      if (
        (prefix.length === 2 && prefix[0] === "content") ||
        (prefix.length === 3 &&
          ["message", "payload"].includes(String(prefix[0])) &&
          prefix[1] === "content")
      )
        tools.set(id, [...(tools.get(id) ?? []), JSON.stringify(prefix)]);
    }
  }
  return rows.map((row) => {
    if (
      !row ||
      row.authority === "derived_context" ||
      derived.has(row.event) ||
      ["provenance", "timestamp", "id"].includes(String(row.path[0]))
    )
      return "unknown";
    const id = key(row),
      path = row.path.slice(scope(row.path).length);
    if (
      (tools.get(id) ?? []).some(
        (prefix) =>
          JSON.stringify(path.slice(0, JSON.parse(prefix).length)) === prefix,
      )
    )
      return "tool";
    // A command's output is observed data; its submitted command/arguments are
    // not proof of execution. Do not assign a tool role to the entire wrapper.
    if (
      executions.has(id) &&
      [
        "stdout",
        "stderr",
        "aggregated_output",
        "formatted_output",
        "exit_code",
      ].includes(String(path[0]))
    )
      return "tool";
    return roles.get(id) ?? "unknown";
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
