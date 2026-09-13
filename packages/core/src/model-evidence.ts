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
  spans?: { start: number }[];
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
  type Part = { row: number; start: number; end: number };
  type Unit = {
    text: string;
    parts: Part[];
    event?: string | number;
    field?: string;
    segment?: number;
  };
  const units: Unit[] = [];
  for (
    let index = 0;
    index < rows.length && source.start + index <= source.end;
    index++
  ) {
    const raw = rows[index];
    // Keep support for a full raw row even if its supplied position was wrong.
    if (raw === evidence.quote)
      units.push({
        text: raw,
        parts: [{ row: index, start: 0, end: raw.length }],
      });
    try {
      const row = JSON.parse(raw),
        field = JSON.parse(row.field);
      if (
        !["string", "number"].includes(typeof row.event) ||
        typeof row.text !== "string" ||
        !Array.isArray(field)
      )
        continue;
      const segment =
        Number.isSafeInteger(row.segment) && row.segment >= 0
          ? (row.segment as number)
          : undefined;
      const previous = units.at(-1);
      // Transport splits one JSON field without inserting separators. Only
      // adjacent rows of that exact event/field with consecutive segment IDs
      // are a continuation. Blank, missing or other-field rows break the run.
      if (
        segment !== undefined &&
        previous?.segment !== undefined &&
        previous.segment + 1 === segment &&
        previous.event === row.event &&
        previous.field === JSON.stringify(field) &&
        previous.parts.at(-1)!.row === index - 1 &&
        !source.spans?.some((span) => span.start === source.start + index)
      ) {
        previous.parts.push({
          row: index,
          start: previous.text.length,
          end: previous.text.length + row.text.length,
        });
        previous.text += row.text;
        previous.segment = segment;
      } else {
        units.push({
          text: row.text,
          parts: [{ row: index, start: 0, end: row.text.length }],
          event: row.event,
          field: JSON.stringify(field),
          segment,
        });
      }
    } catch {
      /* Non-field rows remain eligible only for an exact raw-row quote. */
    }
  }
  let match: Evidence | null = null;
  for (const unit of units) {
    const position = unit.text.indexOf(evidence.quote);
    if (position < 0) continue;
    if (match || unit.text.indexOf(evidence.quote, position + 1) >= 0)
      return null;
    const first = unit.parts.find(
      (p) => p.start <= position && position < p.end,
    )!;
    const lastPosition = position + evidence.quote.length - 1;
    const last = unit.parts.find(
      (p) => p.start <= lastPosition && lastPosition < p.end,
    )!;
    match = {
      ...evidence,
      lines: [source.start + first.row, source.start + last.row],
      quote: rows.slice(first.row, last.row + 1).join("\n"),
    };
  }
  return match;
}
