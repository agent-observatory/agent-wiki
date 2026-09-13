import { lexicalTerms } from "./knowledge-candidates.js";
import { searchTermGroups } from "./search-terms.js";
export const QUERY_POLICY = "bm25-fields-1";
export interface QueryDocument {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  aliases?: string[];
}
// BM25 per field, combined with fixed title/alias/body weights. The corpus is
// workspace-local; scores express relevance, never truth or decision validity.
export function rankQueryDocuments<T extends QueryDocument>(
  documents: T[],
  query: string,
) {
  const terms = new Set(lexicalTerms(query));
  const fields = documents.map((d) =>
    [
      d.title,
      [...(d.tags ?? []), ...(d.aliases ?? [])].join(" "),
      d.content,
    ].map((s) => lexicalTerms(s)),
  );
  const averages = [0, 1, 2].map(
    (f) =>
      fields.reduce((sum, d) => sum + d[f].length, 0) /
        Math.max(1, documents.length) || 1,
  );
  const df = new Map<string, number>();
  for (const doc of fields)
    for (const term of new Set(doc.flat()))
      if (terms.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
  return documents
    .map((document, i) => {
      let score = 0;
      const matched = new Set<string>();
      fields[i].forEach((tokens, f) => {
        const counts = new Map<string, number>();
        for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
        for (const term of terms) {
          const tf = counts.get(term) ?? 0;
          if (!tf) continue;
          matched.add(term);
          const idf = Math.log(
            1 +
              (documents.length - (df.get(term) ?? 0) + 0.5) /
                ((df.get(term) ?? 0) + 0.5),
          );
          score +=
            ([4, 3, 1][f] * idf * tf * 2.2) /
            (tf + 1.2 * (0.25 + (0.75 * tokens.length) / averages[f]));
        }
      });
      // Partial technical names and Korean compounds remain discoverable even
      // without a morphological tokenizer. Keep fallback below exact term hits.
      let fallback = 0;
      for (const group of searchTermGroups(query)) {
        if (group.some((t) => document.title.toLowerCase().includes(t)))
          fallback += 0.03;
        else if (
          group.some((t) =>
            [...(document.aliases ?? []), ...(document.tags ?? [])]
              .join(" ")
              .toLowerCase()
              .includes(t),
          )
        )
          fallback += 0.02;
        else if (group.some((t) => document.content.toLowerCase().includes(t)))
          fallback += 0.01;
      }
      return { document, score: score + fallback, matched: [...matched] };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id),
    );
}
export function legacyQueryRank<T extends QueryDocument>(
  docs: T[],
  query: string,
) {
  const groups = searchTermGroups(query);
  return docs
    .map((document) => {
      let coverage = 0,
        score = 0;
      for (const group of groups) {
        const has = (s: string) =>
          group.some((t) => s.toLowerCase().includes(t));
        const weight = has(document.title)
          ? 4
          : has(
                [...(document.tags ?? []), ...(document.aliases ?? [])].join(
                  " ",
                ),
              )
            ? 3
            : has(document.content)
              ? 1
              : 0;
        if (weight) coverage++;
        score += weight;
      }
      return { document, score, coverage };
    })
    .filter((x) => x.coverage)
    .sort(
      (a, b) =>
        b.coverage - a.coverage ||
        b.score - a.score ||
        a.document.id.localeCompare(b.document.id),
    );
}
