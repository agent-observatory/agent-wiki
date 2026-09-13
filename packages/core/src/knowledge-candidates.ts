import { searchTermGroups } from "./search-terms.js";

// A small personal-workspace corpus: lexical retrieval, not embeddings. Keep
// retrieval and reranking separate so either can be evaluated independently.
export const CANDIDATE_POLICY = "bm25-field-diversity-1";
export const CANDIDATE_LIMIT = 24;
const stop = new Set(
  "그거 이것 저것 해당 같은 다른 현재 이전 사용 사용한다 한다 있다 있는 없다 없는 것이다 합니다 해줘 하자 다시 그리고 또는 위해 대한 대해서 지금 일단 the and or is are to of in for with this that it we".split(
    " ",
  ),
);
export function lexicalTerms(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .map((word) => searchTermGroups(word)[0]?.at(-1) ?? "")
    .filter(
      (word) => word.length > 1 && !/^\d+$/.test(word) && !stop.has(word),
    );
}

export interface KnowledgeCandidate {
  id: string;
  anchor: string;
  title: string;
  text: string;
  subject: string;
  scope: string;
  aliases: string[];
  same_session: boolean;
}
export interface RankedCandidate<T> {
  candidate: T;
  bm25: number;
  score: number;
  matched: string[];
  reasons: string[];
}
export function rankKnowledgeCandidates<T extends KnowledgeCandidate>(
  corpus: T[],
  query: string,
) {
  const terms = new Set(lexicalTerms(query));
  const docs = corpus.map((candidate) => {
    const tokens = lexicalTerms(
      [
        candidate.title,
        candidate.subject,
        candidate.scope,
        ...candidate.aliases,
        candidate.text,
      ].join(" "),
    );
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    return { candidate, counts, length: tokens.length };
  });
  const df = new Map<string, number>();
  for (const doc of docs)
    for (const term of doc.counts.keys())
      if (terms.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
  const n = docs.length;
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / (n || 1) || 1;
  const idf = (term: string) =>
    Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
  const lexical: RankedCandidate<T>[] = [];
  for (const doc of docs) {
    let bm25 = 0;
    const matched: string[] = [];
    for (const [term, tf] of doc.counts) {
      if (!terms.has(term)) continue;
      matched.push(term);
      // Robertson/Lucene BM25, k1=1.2, b=0.75. Query frequency is binary so
      // repeated tool output cannot multiply the importance of one query word.
      bm25 +=
        (idf(term) * tf * 2.2) /
        (tf + 1.2 * (0.25 + (0.75 * doc.length) / avg));
    }
    if (bm25 > 0)
      lexical.push({
        candidate: doc.candidate,
        bm25,
        score: bm25,
        matched,
        reasons: ["bm25"],
      });
  }
  const stable = (a: RankedCandidate<T>, b: RankedCandidate<T>) =>
    a.candidate.id.localeCompare(b.candidate.id) ||
    a.candidate.anchor.localeCompare(b.candidate.anchor);
  lexical.sort((a, b) => b.bm25 - a.bm25 || stable(a, b));
  const candidates = lexical.slice(0, CANDIDATE_LIMIT).map((hit) => {
    let bonus = 0;
    const reasons = [...hit.reasons];
    for (const [name, value, weight] of [
      ["subject", hit.candidate.subject, 0.3],
      ["scope", hit.candidate.scope, 0.15],
      ["alias", hit.candidate.aliases.join(" "), 0.25],
    ] as const) {
      if (lexicalTerms(value).some((term) => terms.has(term))) {
        bonus += weight;
        reasons.push(name);
      }
    }
    return { ...hit, score: hit.bm25 * (1 + bonus), reasons };
  });
  // A chunk can contain several agendas. Penalise redundant term coverage,
  // without interpreting similarity or recency as permission to merge claims.
  const ranked: RankedCandidate<T>[] = [];
  const covered = new Set<string>();
  while (candidates.length) {
    const marginal = (hit: RankedCandidate<T>) => {
      const total = hit.matched.reduce((sum, term) => sum + idf(term), 0);
      const fresh = hit.matched.reduce(
        (sum, term) => sum + (covered.has(term) ? 0 : idf(term)),
        0,
      );
      return hit.score * (0.5 + (0.5 * fresh) / total);
    };
    candidates.sort((a, b) => marginal(b) - marginal(a) || stable(a, b));
    const next = candidates.shift()!;
    ranked.push(next);
    next.matched.forEach((term) => covered.add(term));
  }
  // Explicitly ambiguous continuation is a hint, never a resolved reference.
  // Do not fill unrelated queries from the same session or latest documents.
  if (
    !ranked.length &&
    /그거|그것|이거|이것|that decision|that choice/i.test(query)
  ) {
    const same = corpus
      .filter((item) => item.same_session)
      .sort(
        (a, b) => a.id.localeCompare(b.id) || a.anchor.localeCompare(b.anchor),
      );
    // Multiple possible antecedents are ambiguous: pass none rather than guess.
    if (same.length === 1)
      ranked.push({
        candidate: same[0],
        bm25: 0,
        score: 0,
        matched: [],
        reasons: ["ambiguous_session_reference"],
      });
  }
  return {
    ranked,
    matchedCandidates: lexical.length,
    corpusSize: n,
    queryTerms: terms.size,
  };
}
