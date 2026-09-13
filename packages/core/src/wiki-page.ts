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
  current: "현재",
  proposed: "검토 의견",
  unconfirmed: "미확인",
  conflicted: "미해결 충돌",
  superseded: "대체됨",
  retracted: "철회됨",
};
const types: Record<string, string> = {
  user_decision: "Decision",
  observation: "Observation",
  ai_inference: "AI 해석",
  unconfirmed: "미확인",
  author_statement: "작성자 진술",
};
export function renderWikiPage(
  title: string,
  claims: PageClaim[],
  relations: PageRelation[],
  root: string,
  references: PageClaim[] = [],
) {
  const href = (c: PageClaim) =>
    `${root}/${c.article_id}?revision=${c.revision}&tab=evidence#${c.anchor}`;
  const paragraph = (c: PageClaim) =>
    `${c.text}\n\n[${types[c.type] ?? "Claim"} · ${c.scope || "범위 미지정"} · 근거](${href(c)})`;
  const current = claims.filter((c) => c.state === "current");
  const unresolved = claims.filter((c) =>
    ["proposed", "unconfirmed", "conflicted"].includes(c.state),
  );
  const history = claims.filter((c) =>
    ["superseded", "retracted"].includes(c.state),
  );
  const sections: string[] = [];
  for (const [heading, items] of [
    ["현재 상태와 설명", current],
    ["미해결 사항과 검토 의견", unresolved],
    ["과거 결정과 주장", history],
  ] as const) {
    if (items.length)
      sections.push(
        `## ${heading}\n\n` +
          items
            .map(
              (c) =>
                `### ${c.title}${c.state === "current" ? "" : ` · ${states[c.state]}`}\n\n${paragraph(c)}`,
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
