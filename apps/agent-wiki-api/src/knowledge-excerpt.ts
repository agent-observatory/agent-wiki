import { searchTermGroups } from "../../../packages/core/src/search-terms.js";
export function excerpt(content: string, q: string, limit = 1600) {
  const groups = searchTermGroups(q);
  let start = 0;
  if (groups.length && limit > 0 && content.length > limit) {
    const step = Math.max(1, Math.floor(limit / 4));
    const padding = Math.min(240, step);
    const starts = new Set([0, Math.max(0, content.length - limit)]);
    for (let offset = 0; offset < content.length; offset += step)
      starts.add(offset);
    // Preserve useful leading context around each term's first occurrence.
    const lower = content.toLowerCase();
    for (const term of groups.flat()) {
      const hit = lower.indexOf(term);
      if (hit >= 0) starts.add(Math.max(0, hit - padding));
    }
    let bestCoverage = 0,
      bestDistance = Infinity;
    for (const offset of [...starts].sort((a, b) => a - b)) {
      const window = content.slice(offset, offset + limit).toLowerCase();
      const positions = groups
        .map((terms) => {
          const hits = terms
            .map((term) => window.indexOf(term))
            .filter((hit) => hit >= 0);
          return hits.length ? Math.min(...hits) : -1;
        })
        .filter((hit) => hit >= 0);
      const coverage = positions.length;
      const distance = coverage
        ? Math.abs(Math.min(...positions) - padding)
        : Infinity;
      if (
        coverage > bestCoverage ||
        (coverage > 0 && coverage === bestCoverage && distance < bestDistance)
      ) {
        start = offset;
        bestCoverage = coverage;
        bestDistance = distance;
      }
    }
  }
  return {
    text: content.slice(start, start + limit),
    start,
    end: Math.min(content.length, start + limit),
    truncated: start > 0 || content.length > start + limit,
  };
}
