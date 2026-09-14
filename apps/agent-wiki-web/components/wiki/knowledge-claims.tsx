"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { When } from "./common";
// Structured claims list + lineage panel, drawn from the same Wiki Page
// Version snapshot the markdown already used (no new API, no new storage).
// docs/l2-l3-memory.md#knowledge-화면--현재-주장-목록과-리니지-패널.
//
// Layout rules for a real topic (98 current claims, 53 in one group, ~10
// touching any relation):
// - Only claims that sit on at least one relation are clickable; they carry
//   a lineage badge so the reader knows before clicking. Unlinked claims are
//   plain rows — no hover, no chevron — so there is no "blind click".
// - Inside a (subject, scope) group, linked claims come first, the rest keep
//   snapshot order. Groups longer than GROUP_PREVIEW collapse behind
//   "나머지 N개 보기" but never hide a linked claim.
// - The lineage panel is a right-side Sheet (DESIGN.md: 본문·리니지 → Sheet),
//   reachable at any scroll position, closed by X / Escape / overlay.
const GROUP_PREVIEW = 10;
const typeLabels: Record<string, string> = {
  user_decision: "Decision",
  observation: "Observation",
  ai_inference: "AI 해석",
  unconfirmed: "미확인",
  author_statement: "작성자 진술",
};
const unresolvedLabels: Record<string, string> = {
  proposed: "검토 의견",
  unconfirmed: "미확인",
  conflicted: "미해결 충돌",
};
const relationLabels: Record<string, string> = {
  supersedes: "대체",
  retracts: "철회",
  contradicts: "충돌",
  supports: "근거 추가",
};
function producerLabel(client?: string | null) {
  if (client === "remote-worker") return "추출";
  if (client === "consolidation-worker") return "통합";
  return "수동";
}
type ClaimRef = { article_id: string; revision: number; anchor: string };
type Relation = {
  from_article_id: string;
  from_revision: number;
  from_anchor: string;
  to_article_id: string;
  to_revision: number;
  to_anchor: string;
  relation: string;
  producer_client?: string | null;
  published_at?: string | null;
};
function claimKey(c: ClaimRef) {
  return `${c.article_id}:${c.revision}:${c.anchor}`;
}
function relationRef(r: Relation, side: "from" | "to"): ClaimRef {
  return side === "from"
    ? {
        article_id: r.from_article_id,
        revision: r.from_revision,
        anchor: r.from_anchor,
      }
    : {
        article_id: r.to_article_id,
        revision: r.to_revision,
        anchor: r.to_anchor,
      };
}
function relKeyOf(r: Relation) {
  return [
    r.from_article_id,
    r.from_revision,
    r.from_anchor,
    r.to_article_id,
    r.to_revision,
    r.to_anchor,
    r.relation,
  ].join(":");
}
// One claim's view of the snapshot relations, split exactly the way the
// panel lists them, so the badge on the row and the panel never disagree.
type Lineage = {
  backward: Relation[]; // this claim supersedes/retracts …
  forward: Relation[]; // … is superseded/retracted by
  contradicts: Relation[];
  supports: Relation[]; // incoming 근거 추가
  total: number;
};
function lineageOf(key: string, relations: Relation[]): Lineage {
  const isEnd = (r: Relation, side: "from" | "to") =>
    claimKey(relationRef(r, side)) === key;
  const backward = relations.filter(
    (r) => isEnd(r, "from") && ["supersedes", "retracts"].includes(r.relation),
  );
  const forward = relations.filter(
    (r) => isEnd(r, "to") && ["supersedes", "retracts"].includes(r.relation),
  );
  const contradicts = relations.filter(
    (r) => r.relation === "contradicts" && (isEnd(r, "from") || isEnd(r, "to")),
  );
  const supports = relations.filter(
    (r) => r.relation === "supports" && isEnd(r, "to"),
  );
  return {
    backward,
    forward,
    contradicts,
    supports,
    total:
      backward.length + forward.length + contradicts.length + supports.length,
  };
}
function lineageSummary(l: Lineage) {
  const parts: string[] = [];
  const replaced = l.backward.length + l.forward.length;
  if (replaced) parts.push(`대체 ${replaced}`);
  if (l.contradicts.length) parts.push(`충돌 ${l.contradicts.length}`);
  if (l.supports.length) parts.push(`근거 ${l.supports.length}`);
  return parts.join(" · ");
}
type Group = {
  key: string;
  subject: string;
  scope: string;
  items: any[];
  linked: number;
  unresolved: [string, number][];
};
export function KnowledgeClaims({
  snapshot,
  root,
}: {
  snapshot: any;
  root: string;
}) {
  const claims: any[] = snapshot.claims ?? [];
  const references: any[] = snapshot.references ?? [];
  const relations: Relation[] = snapshot.relations ?? [];
  const rejections: any[] = snapshot.rejections ?? [];
  // `selected` survives closing so the Sheet keeps its content through the
  // slide-out animation instead of blanking mid-way.
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const byKey = new Map<string, any>();
  for (const c of [...claims, ...references]) byKey.set(claimKey(c), c);
  const rejectionByKey = new Map(rejections.map((r) => [relKeyOf(r), r]));
  const lineageByKey = new Map<string, Lineage>();
  for (const c of claims) {
    const key = claimKey(c);
    lineageByKey.set(key, lineageOf(key, relations));
  }
  const current = claims.filter((c) => c.state === "current");
  // Group key is the pair itself, not a joined string: a subject containing
  // a space must not split into the wrong (subject, scope).
  const groupMap = new Map<string, Group>();
  for (const c of current) {
    const subject = c.subject && c.scope ? String(c.subject) : "";
    const scope = c.subject && c.scope ? String(c.scope) : "";
    const key = JSON.stringify([subject, scope]);
    let g = groupMap.get(key);
    if (!g) {
      g = { key, subject, scope, items: [], linked: 0, unresolved: [] };
      groupMap.set(key, g);
    }
    g.items.push(c);
    if (lineageByKey.get(claimKey(c))!.total) g.linked += 1;
  }
  for (const g of groupMap.values()) {
    if (!g.subject) continue;
    const counts = new Map<string, number>();
    for (const c of claims)
      if (
        c.subject === g.subject &&
        c.scope === g.scope &&
        c.state in unresolvedLabels
      )
        counts.set(c.state, (counts.get(c.state) ?? 0) + 1);
    g.unresolved = [...counts.entries()];
    // Linked first (stable), then the snapshot's own order.
    g.items = [
      ...g.items.filter((c) => lineageByKey.get(claimKey(c))!.total),
      ...g.items.filter((c) => !lineageByKey.get(claimKey(c))!.total),
    ];
  }
  const groups = [...groupMap.values()].sort((a, b) =>
    a.subject === ""
      ? 1
      : b.subject === ""
        ? -1
        : `${a.subject} ${a.scope}`.localeCompare(`${b.subject} ${b.scope}`),
  );
  const linkedTotal = current.filter(
    (c) => lineageByKey.get(claimKey(c))!.total,
  ).length;
  const selectedClaim = selected ? byKey.get(selected) : null;
  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  return (
    <div className="space-y-8">
      {!groups.length ? (
        <p className="text-muted-foreground">현재 유효한 주장이 없습니다.</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          현재 주장 {current.length.toLocaleString()}개 · 묶음 {groups.length}개
          · 관계가 연결된 주장 {linkedTotal}개.
          {linkedTotal > 0
            ? " 관계 배지가 있는 주장을 누르면 리니지를 봅니다."
            : " 아직 통합이 연결한 관계가 없습니다."}
        </p>
      )}
      {groups.map((g) => {
        const isOpen = expanded.has(g.key);
        // Never collapse a linked claim: preview covers at least all of them.
        const previewCount = Math.max(GROUP_PREVIEW, g.linked);
        const visible = isOpen ? g.items : g.items.slice(0, previewCount);
        const hidden = g.items.length - visible.length;
        return (
          <section key={g.key}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="font-bold">
                {g.subject ? `${g.subject} · ${g.scope}` : "미분류"}
              </h2>
              <Badge variant="outline">{g.items.length}개</Badge>
              {g.linked > 0 && (
                <Badge variant="secondary">
                  <GitBranch />
                  관계 {g.linked}개
                </Badge>
              )}
              {g.unresolved.map(([state, n]) => (
                <Badge variant="secondary" key={state}>
                  {unresolvedLabels[state]} {n}건
                </Badge>
              ))}
            </div>
            <div className="divide-y rounded-lg border">
              {visible.map((c) => {
                const key = claimKey(c);
                const lineage = lineageByKey.get(key)!;
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {typeLabels[c.type] ?? c.type}
                        </Badge>
                        {lineage.total > 0 && (
                          <Badge variant="secondary">
                            <GitBranch />
                            {lineageSummary(lineage)}
                          </Badge>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap leading-7">{c.text}</p>
                    </div>
                    {lineage.total > 0 && (
                      <ChevronRight
                        className="mt-1 size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </>
                );
                return lineage.total > 0 ? (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={open && selected === key}
                    onClick={() => {
                      setSelected(key);
                      setOpen(true);
                    }}
                    className={`flex w-full items-start gap-4 px-4 py-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                      open && selected === key ? "bg-accent/40" : ""
                    }`}
                  >
                    {body}
                  </button>
                ) : (
                  <div
                    key={key}
                    className="flex w-full items-start gap-4 px-4 py-3"
                  >
                    {body}
                  </div>
                );
              })}
            </div>
            {(hidden > 0 || (isOpen && g.items.length > previewCount)) && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-muted-foreground"
                onClick={() => toggleGroup(g.key)}
                aria-expanded={isOpen}
              >
                {isOpen ? "접기" : `나머지 ${hidden}개 보기`}
              </Button>
            )}
          </section>
        );
      })}
      <Sheet open={open && !!selectedClaim} onOpenChange={setOpen}>
        <SheetContent side="right" className="gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b p-6 pr-12">
            <SheetTitle>리니지</SheetTitle>
            {selectedClaim && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {typeLabels[selectedClaim.type] ?? selectedClaim.type}
                  </Badge>
                  {selectedClaim.subject && selectedClaim.scope && (
                    <Badge variant="outline">
                      {selectedClaim.subject} · {selectedClaim.scope}
                    </Badge>
                  )}
                </div>
                <SheetDescription className="line-clamp-4 whitespace-pre-wrap leading-6 text-foreground">
                  {selectedClaim.text}
                </SheetDescription>
              </>
            )}
          </SheetHeader>
          {selectedClaim && (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <LineagePanel
                claim={selectedClaim}
                lineage={lineageByKey.get(claimKey(selectedClaim))!}
                byKey={byKey}
                rejectionByKey={rejectionByKey}
                root={root}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
function LineagePanel({
  claim,
  lineage,
  byKey,
  rejectionByKey,
  root,
}: {
  claim: any;
  lineage: Lineage;
  byKey: Map<string, any>;
  rejectionByKey: Map<string, any>;
  root: string;
}) {
  const key = claimKey(claim);
  const isEnd = (r: Relation, side: "from" | "to") =>
    claimKey(relationRef(r, side)) === key;
  const { backward, forward, contradicts, supports } = lineage;
  const row = (r: Relation, otherSide: "from" | "to", label: string) => {
    const target = byKey.get(claimKey(relationRef(r, otherSide)));
    const rejected = rejectionByKey.get(relKeyOf(r));
    return (
      <li key={relKeyOf(r)} className="border-b pb-3 last:border-0">
        <div className="text-xs text-muted-foreground">
          {label} · {producerLabel(r.producer_client)}
          {r.published_at ? (
            <>
              {" · "}
              <When value={r.published_at} compact />
            </>
          ) : null}
        </div>
        {target ? (
          <Link
            href={`${root}/${target.article_id}?revision=${target.revision}&tab=evidence#${target.anchor}`}
            className={`mt-1 block underline ${rejected ? "text-muted-foreground line-through" : ""}`}
          >
            {target.title}
          </Link>
        ) : (
          <span className="mt-1 block text-muted-foreground">
            대상 정보 없음
          </span>
        )}
        {target?.text && (
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
            {target.text}
          </p>
        )}
        {rejected && (
          <p className="mt-1 text-xs text-muted-foreground">
            거절됨 · {rejected.reason}
            {rejected.publication_id && (
              <>
                {" · "}
                {/* The corrective Version always lands on the relation's own
                    "to" side (both sides for contradicts) — never on
                    whichever claim happens to be selected here. */}
                <Link className="underline" href={`${root}/${r.to_article_id}`}>
                  정정 Version 보기
                </Link>
              </>
            )}
          </p>
        )}
      </li>
    );
  };
  const empty =
    !backward.length &&
    !forward.length &&
    !contradicts.length &&
    !supports.length;
  return (
    <div className="space-y-5 text-sm">
      {backward.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">이 주장이 대체한 것</h4>
          <ul>
            {backward.map((r) => row(r, "to", relationLabels[r.relation]))}
          </ul>
        </div>
      )}
      {forward.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">이 주장을 대체한 것</h4>
          <ul>
            {forward.map((r) => row(r, "from", relationLabels[r.relation]))}
          </ul>
        </div>
      )}
      {contradicts.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">충돌</h4>
          <ul>
            {contradicts.map((r) =>
              row(r, isEnd(r, "from") ? "to" : "from", "충돌"),
            )}
          </ul>
        </div>
      )}
      {supports.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">근거 추가</h4>
          <ul>{supports.map((r) => row(r, "from", "근거 추가"))}</ul>
        </div>
      )}
      {empty && (
        <p className="text-muted-foreground">연결된 관계가 없습니다.</p>
      )}
    </div>
  );
}
