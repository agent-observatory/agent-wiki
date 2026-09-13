type Evidence = {
  sourceId: string;
  revision: number;
  lines: [number, number];
  quote: string;
};
type Source = {
  id: string;
  revision: number;
  start: number;
  end: number;
  text: string;
};

// A model may count lines inside a JSON string instead of immutable L1 rows.
// Resolve only an exact, unique quote in the supplied chunk; never search
// reference context, guess an offset, or use fuzzy matching.
export function anchorModelEvidence(
  evidence: Evidence,
  source: Source,
): Evidence | null {
  if (
    evidence.sourceId !== source.id ||
    evidence.revision !== source.revision ||
    !evidence.quote.trim()
  )
    return null;
  const rows = source.text.split("\n");
  if (
    evidence.lines[0] >= source.start &&
    evidence.lines[1] <= source.end &&
    rows
      .slice(
        evidence.lines[0] - source.start,
        evidence.lines[1] - source.start + 1,
      )
      .join("\n") === evidence.quote
  )
    return null;
  let match: Evidence | null = null;
  for (
    let index = 0;
    index < rows.length && source.start + index <= source.end;
    index++
  ) {
    const raw = rows[index];
    let text = raw;
    if (raw !== evidence.quote) {
      try {
        const row = JSON.parse(raw);
        if (
          !["string", "number"].includes(typeof row.event) ||
          typeof row.text !== "string" ||
          !Array.isArray(JSON.parse(row.field))
        )
          continue;
        text = row.text;
      } catch {
        continue;
      }
    }
    const position = text.indexOf(evidence.quote);
    if (position < 0) continue;
    if (match || text.indexOf(evidence.quote, position + 1) >= 0) return null;
    const line = source.start + index;
    match = { ...evidence, lines: [line, line], quote: raw };
  }
  return match;
}
