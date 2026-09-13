import { ModelError } from "./ai.js";

type Source = {
  id: string;
  revision: number;
  start: number;
  end: number;
  text: string;
  omittedLines?: { start: number; end: number }[];
};
/** Give the model selectable records, never ask it to reproduce escaped source text. */
export function modelRecords(source: Source) {
  return source.text.split("\n").flatMap((raw, index) => {
    const line = source.start + index;
    if (
      line > source.end ||
      !raw.trim() ||
      (source.omittedLines ?? []).some((r) => r.start <= line && r.end >= line)
    )
      return [];
    let text = raw;
    try {
      const field = JSON.parse(raw);
      if (typeof field.text === "string") text = field.text;
    } catch {}
    return [{ recordId: `record-${line}`, text }];
  });
}
export function modelSource<T extends Source>(source: T) {
  const { text, ...metadata } = source;
  return { ...metadata, spans: undefined, records: modelRecords(source) };
}
export function resolveRecordEvidence(output: unknown, source: Source) {
  const result = structuredClone(output) as any;
  if (!Array.isArray(result?.changes)) return result;
  const allowed = new Map(modelRecords(source).map((r) => [r.recordId, r]));
  const rows = source.text.split("\n");
  for (const change of result.changes)
    for (const entry of [
      ...(change.claims ?? []),
      ...(change.claimRelations ?? []),
    ]) {
      if (!Array.isArray(entry.evidence)) continue;
      entry.evidence = entry.evidence.map((ev: any) => {
        // Legacy public evidence remains independently verified; never silently repair a bad quote.
        if (!ev || !("recordId" in ev)) return ev;
        if (Object.keys(ev).length !== 1 || !allowed.has(ev.recordId))
          throw new ModelError("AI_EVIDENCE_REFERENCE_INVALID");
        const line = Number(ev.recordId.slice(7));
        return {
          sourceId: source.id,
          revision: source.revision,
          lines: [line, line],
          quote: rows[line - source.start],
        };
      });
    }
  return result;
}
