// Query spelling alternatives, not a Korean morphological analyser.
const filler = new Set([
  "왜",
  "뭐",
  "무엇",
  "어떻게",
  "어디",
  "어디에",
  "어떤",
  "좀",
  "그냥",
  "the",
  "a",
  "an",
]);
const particle =
  /^(.{2,}?)(?:에서는|으로는|에서|으로|에게|까지|부터|처럼|보다|은|는|이|가|을|를|의|에|로|와|과|도|만)$/u;
export function searchTermGroups(query: string): string[][] {
  const groups = new Map<string, Set<string>>();
  for (const value of query
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .split(/\s+/)) {
    const word = value.replace(
      /^[?!.,;:()[\]{}"'“”‘’]+|[?!.,;:()[\]{}"'“”‘’]+$/g,
      "",
    );
    if (!word || filler.has(word)) continue;
    const stem = particle.exec(word)?.[1] ?? word;
    if (filler.has(stem)) continue;
    const alternatives = groups.get(stem) ?? new Set<string>();
    alternatives.add(word);
    alternatives.add(stem);
    groups.set(stem, alternatives);
    if (groups.size >= 8) break;
  }
  return [...groups.values()].map((terms) => [...terms]);
}

export function searchPatterns(query: string): string[][] {
  return searchTermGroups(query).map((terms) =>
    terms.map((term) => "%" + term.replace(/[\\%_]/g, "\\$&") + "%"),
  );
}
