export const CHUNK_VERSION = "conversation-lines-1";
// Conservative byte-fallback estimate, not the provider's exact tokenizer.
export function estimateTokens(text: string) {
  return Buffer.byteLength(text, "utf8");
}
export type Chunk = {
  start: number;
  end: number;
  contextStart: number;
  contextEnd: number;
};
export function planChunks(
  text: string,
  budget: number,
  count = estimateTokens,
): Chunk[] {
  const lines = text.split("\n"),
    groups: { start: number; end: number }[] = [];
  let begin = 0,
    last: unknown;
  for (let i = 0; i < lines.length; i++) {
    let event: unknown;
    try {
      event = JSON.parse(lines[i]).event;
    } catch {}
    // Prefer event boundaries; plain sources use paragraph boundaries.
    if (
      i > begin &&
      ((event !== undefined && event !== last) ||
        (event === undefined && lines[i - 1] === ""))
    ) {
      groups.push({ start: begin, end: i });
      begin = i;
    }
    last = event;
  }
  groups.push({ start: begin, end: lines.length });
  const units: { start: number; end: number; origin: number }[] = [];
  for (const group of groups) {
    let start = group.start,
      size = 0;
    for (let i = group.start; i < group.end; i++) {
      const bytes = count(JSON.stringify(lines[i]) + "\n");
      if (bytes > budget) throw new Error("AI_LINE_TOO_LARGE");
      if (size + bytes > budget && i > start) {
        units.push({ start, end: i, origin: group.start });
        start = i;
        size = 0;
      }
      size += bytes;
    }
    units.push({ start, end: group.end, origin: group.start });
  }
  const result: Chunk[] = [];
  let start = 0,
    end = 0,
    size = 0,
    origin = 0;
  const flush = () => {
    if (end > start)
      result.push({
        start: start + 1,
        end,
        contextStart: origin + 1,
        contextEnd: Math.min(start, origin + 3),
      });
  };
  for (const u of units) {
    const bytes = lines
      .slice(u.start, u.end)
      .reduce((n, line) => n + count(JSON.stringify(line) + "\n"), 0);
    if (size + bytes > budget && end > start) {
      flush();
      start = u.start;
      size = 0;
      origin = u.origin;
    }
    end = u.end;
    size += bytes;
  }
  flush();
  return result;
}
