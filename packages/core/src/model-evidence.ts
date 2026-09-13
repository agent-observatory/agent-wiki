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

// Counts exact positions and quotations, not whether a claim is true.
export function summarizeModelEvidence(evidence: Evidence[], source: Source) {
  const rows = source.text.split("\n");
  const matched = evidence.filter(
    (e) =>
      e.sourceId === source.id &&
      e.revision === source.revision &&
      e.lines[0] >= source.start &&
      e.lines[1] <= source.end &&
      e.lines[1] >= e.lines[0] &&
      e.quote.trim().length > 0 &&
      rows
        .slice(e.lines[0] - source.start, e.lines[1] - source.start + 1)
        .join("\n") === e.quote,
  ).length;
  return {
    checked: evidence.length,
    matched,
    mismatched: evidence.length - matched,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Normalize the model's single-row shorthand without changing its stored output
// or loosening the public publication contract.
export function normalizeModelEvidence(output: unknown): unknown {
  const normalized = structuredClone(output);
  const changes = record(normalized)?.changes;
  if (!Array.isArray(changes)) return normalized;
  for (const change of changes) {
    for (const name of ["claims", "claimRelations"]) {
      const entries = record(change)?.[name];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const evidence = record(entry)?.evidence;
        if (!Array.isArray(evidence)) continue;
        for (const value of evidence) {
          const item = record(value);
          const lines = item?.lines;
          if (
            item &&
            Array.isArray(lines) &&
            lines.length === 1 &&
            Number.isSafeInteger(lines[0]) &&
            lines[0] > 0
          )
            item.lines = [lines[0], lines[0]];
        }
      }
    }
  }
  return normalized;
}

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
