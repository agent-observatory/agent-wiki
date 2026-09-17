export type PageClaim = {
  article_id: string;
  revision: number;
  anchor: string;
  text: string;
  type: string;
  subject: string;
  scope: string;
  state: string;
  title: string;
  evidence_times?: { at: string; kind: string }[];
};
export type PageRelation = {
  from_article_id: string;
  from_revision: number;
  from_anchor: string;
  to_article_id: string;
  to_revision: number;
  to_anchor: string;
  relation: string;
};
const states: Record<string, string> = {
  current: "Current",
  proposed: "Proposed",
  unconfirmed: "Unconfirmed",
  conflicted: "Conflicted",
  superseded: "Superseded",
  retracted: "Retracted",
};
const types: Record<string, string> = {
  user_decision: "Decision",
  observation: "Observation",
  ai_inference: "AI Inference",
  agent_statement: "Agent Statement",
  author_statement: "Author Statement",
};
// Who asserted a claim, ranked. A decision must never hide behind an
// observation that merely restates it. author_statement sits with
// user_decision because both are a person's own words.
const AUTHORITY_RANK: Record<string, number> = {
  user_decision: 0,
  author_statement: 1,
  observation: 2,
  ai_inference: 3,
  agent_statement: 4,
};
export type SupportCluster = {
  representative: PageClaim;
  members: PageClaim[];
};
// MUST match the web's own claimKey in
// apps/agent-wiki-web/components/wiki/knowledge-claims.tsx. The snapshot
// carries cluster membership as these strings, and the web looks each one up
// in a map it builds with its own key — a different separator made every
// lookup miss, so the page text folded and the list on screen did not. Pinned
// in tests/wiki-page.test.ts.
export function claimKey(c: {
  article_id: string;
  revision: number;
  anchor: string;
}) {
  return c.article_id + ":" + c.revision + ":" + c.anchor;
}
// Consolidation's dominant verdict is `supports`, and a page that prints every
// member of a support chain shows the reader the same assertion five times.
// Fold each connected component of current claims down to one representative.
// The choice is fully deterministic — engineering owns the unit, the model only
// proposed the edges — so the same corpus always folds the same way regardless
// of row order:
//   1. authority (a decision outranks an observation of it)
//   2. a claim that supports nothing else: the original statement, not a
//      restatement of it
//   3. earliest 'recorded' evidence time (recovered and missing times last,
//      since their ordering is not trustworthy)
//   4. most evidence
//   5. the claim's own identity, so ties still resolve
export function supportClusters(
  claims: PageClaim[],
  relations: PageRelation[],
): SupportCluster[] {
  const nodes = new Map<string, PageClaim>();
  const order: string[] = [];
  for (const c of claims)
    if (c.state === "current" && !nodes.has(claimKey(c))) {
      nodes.set(claimKey(c), c);
      order.push(claimKey(c));
    }
  const parent = new Map<string, string>(order.map((k) => [k, k]));
  const root = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = root(p);
    parent.set(x, r);
    return r;
  };
  const supportsOthers = new Set<string>();
  for (const r of relations) {
    if (r.relation !== "supports") continue;
    const from = claimKey({
        article_id: r.from_article_id,
        revision: r.from_revision,
        anchor: r.from_anchor,
      }),
      to = claimKey({
        article_id: r.to_article_id,
        revision: r.to_revision,
        anchor: r.to_anchor,
      });
    if (!nodes.has(from) || !nodes.has(to) || from === to) continue;
    // storeClaimRelations already refuses a relation whose ends disagree on
    // subject or scope, so this should never fire. Check anyway: folding
    // across subjects would hide a claim inside another subject's group, and
    // it would read as if the claim had never been made.
    const fromClaim = nodes.get(from)!,
      toClaim = nodes.get(to)!;
    if (
      fromClaim.subject !== toClaim.subject ||
      fromClaim.scope !== toClaim.scope
    )
      continue;
    supportsOthers.add(from);
    const a = root(from),
      b = root(to);
    // Merge toward the lexicographically smaller root so the component is
    // built the same way whatever order the relations arrive in.
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
  }
  const recordedAt = (c: PageClaim) => {
    const times = (c.evidence_times ?? [])
      .filter((t) => t.kind === "recorded" && Number.isFinite(Date.parse(t.at)))
      .map((t) => t.at)
      .sort();
    return times[0] ?? null;
  };
  const rank = (k: string): (string | number)[] => {
    const c = nodes.get(k)!;
    const at = recordedAt(c);
    return [
      AUTHORITY_RANK[c.type] ?? 9,
      supportsOthers.has(k) ? 1 : 0,
      at === null ? 1 : 0,
      at ?? "",
      -(c.evidence_times?.length ?? 0),
      k,
    ];
  };
  const better = (a: string, b: string) => {
    const x = rank(a),
      y = rank(b);
    for (let i = 0; i < x.length; i++)
      if (x[i] !== y[i]) return x[i] < y[i] ? a : b;
    return a;
  };
  const groups = new Map<string, string[]>();
  for (const k of order) {
    const r = root(k);
    groups.set(r, [...(groups.get(r) ?? []), k]);
  }
  const clusters: SupportCluster[] = [];
  for (const k of order) {
    const members = groups.get(root(k));
    if (!members || root(k) !== k) continue;
    const pick = members.reduce(better);
    clusters.push({
      representative: nodes.get(pick)!,
      members: members.filter((m) => m !== pick).map((m) => nodes.get(m)!),
    });
  }
  return clusters;
}
export function renderWikiPage(
  title: string,
  claims: PageClaim[],
  relations: PageRelation[],
  root: string,
  references: PageClaim[] = [],
) {
  const href = (c: PageClaim) =>
    `${root}/${c.article_id}?revision=${c.revision}&tab=evidence#${c.anchor}`;
  const timeLabel = (c: PageClaim) => {
    const times = (c.evidence_times ?? [])
      .filter((t) => Number.isFinite(Date.parse(t.at)))
      .sort((a, b) => a.at.localeCompare(b.at));
    if (!times.length) return "시각 미확인";
    const format = (t: { at: string; kind: string }) =>
      (t.kind === "recovered" ? "복구 기록 " : "기록 ") +
      new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(t.at));
    const labels = [...new Set(times.map(format))];
    return (
      labels.slice(0, 2).join(" · ") +
      (labels.length > 2 ? ` 외 ${labels.length - 2}건` : "")
    );
  };
  const paragraph = (c: PageClaim) =>
    `${c.text}\n\n[${types[c.type] ?? "Claim"} · ${c.scope || "범위 미지정"} · ${timeLabel(c)} · 근거](${href(c)})`;
  const clusters = supportClusters(claims, relations);
  const memberLinks = new Map<string, string>(
    clusters
      .filter((c) => c.members.length)
      .map((c) => [
        claimKey(c.representative),
        "재확인 " +
          c.members.length +
          "건 · " +
          c.members.map((m) => `[${m.title}](${href(m)})`).join(" · "),
      ]),
  );
  const current = clusters.map((c) => c.representative);
  const unresolved = claims.filter((c) =>
    ["proposed", "unconfirmed", "conflicted"].includes(c.state),
  );
  const history = claims.filter((c) =>
    ["superseded", "retracted"].includes(c.state),
  );
  const sections: string[] = [];
  for (const [heading, items] of [
    ["현재 상태와 설명", current],
    ["미해결 사항 · Proposed · Unconfirmed · Conflicted", unresolved],
    ["과거 결정과 주장", history],
  ] as const) {
    if (items.length)
      sections.push(
        `## ${heading}\n\n` +
          [...new Set(items.map((c) => c.title))]
            .map(
              (title) =>
                `### ${title}\n\n` +
                items
                  .filter((c) => c.title === title)
                  .map(
                    (c) =>
                      `${c.state === "current" ? "" : `**${states[c.state]}**\n\n`}${paragraph(c)}` +
                      (memberLinks.has(claimKey(c))
                        ? `\n\n${memberLinks.get(claimKey(c))}`
                        : ""),
                  )
                  .join("\n\n"),
            )
            .join("\n\n"),
      );
  }
  const find = (id: string, rev: number, anchor: string) =>
    [...claims, ...references].find(
      (c) => c.article_id === id && c.revision === rev && c.anchor === anchor,
    );
  const changes = relations.flatMap((r) => {
    const from = find(r.from_article_id, r.from_revision, r.from_anchor),
      to = find(r.to_article_id, r.to_revision, r.to_anchor);
    if (!from || !to || r.relation === "supports") return [];
    const verb =
      (
        { supersedes: "대체", retracts: "철회", contradicts: "충돌" } as Record<
          string,
          string
        >
      )[r.relation] ?? r.relation;
    return [
      `[${to.title}](${href(to)}) → ${verb} → [${from.title}](${href(from)})\n\n${from.text}`,
    ];
  });
  if (changes.length)
    sections.push("## Decision History · 변경 근거\n\n" + changes.join("\n\n"));
  return sections.join("\n\n");
}
