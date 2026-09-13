// Time is derived from source structure, never from model prose.
export function sourceRecordTimes(text: string) {
  const rows = text.split("\n").map((raw) => {
    try {
      const r = JSON.parse(raw);
      return { ...r, path: JSON.parse(r.field) };
    } catch {
      return null;
    }
  });
  const events = new Map<unknown, { time?: string; recovered: boolean }>();
  for (const r of rows) {
    if (!r || r.event == null) continue;
    const event = events.get(r.event) ?? { recovered: false };
    if (
      JSON.stringify(r.path) === '["timestamp"]' &&
      typeof r.text === "string" &&
      /^\d{4}-\d\d-\d\dT/.test(r.text) &&
      Number.isFinite(Date.parse(r.text))
    )
      event.time = new Date(r.text).toISOString();
    if (
      JSON.stringify(r.path) === '["provenance","kind"]' &&
      ["compaction_recovered", "derived_context", "compacted"].includes(r.text)
    )
      event.recovered = true;
    events.set(r.event, event);
  }
  return rows.flatMap((r, i) => {
    const event = r && events.get(r.event);
    return event?.time
      ? [
          {
            line: i + 1,
            time: event.time,
            kind: event.recovered ? "recovered" : "recorded",
          },
        ]
      : [];
  });
}
