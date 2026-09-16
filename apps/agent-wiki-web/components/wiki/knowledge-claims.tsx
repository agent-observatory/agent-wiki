"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, GitBranch, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
// - Groups are subject only. scope answers a different question (where the
//   claim applies) and splitting on it scattered one subject across several
//   headings; it rides along as a row badge instead.
// - Inside a group, linked claims come first, the rest keep snapshot order.
//   Groups longer than GROUP_PREVIEW collapse behind "나머지 N개 보기" but
//   never hide a linked claim.
// - A 목차 rail lists the subjects; at 98 claims the plain text filter beats
//   it for "where did we say X", so both are offered.
// - The lineage panel is a right-side Sheet (DESIGN.md: 본문·리니지 → Sheet),
//   reachable at any scroll position, closed by X / Escape / overlay.
const GROUP_PREVIEW = 10;
const typeLabels: Record<string, string> = {
  user_decision: "Decision",
  observation: "Observation",
  ai_inference: "AI Inference",
  agent_statement: "Agent Statement",
  author_statement: "Author Statement",
};
// Schema values keep their English names on screen; only the prose around
// them is Korean. Mixing the two inside one badge row (Decision next to
// "에이전트 진술") made the same axis look like two different things.
const unresolvedLabels: Record<string, string> = {
  proposed: "Proposed",
  unconfirmed: "Unconfirmed",
  conflicted: "Conflicted",
};
const relationLabels: Record<string, string> = {
  supersedes: "Supersedes",
  retracts: "Retracts",
  contradicts: "Contradicts",
  supports: "Supports",
};
function producerLabel(client?: string | null) {
  if (client === "remote-worker") return "Extraction";
  if (client === "consolidation-worker") return "Consolidation";
  return "Manual";
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
  if (replaced) parts.push(`Supersedes ${replaced}`);
  if (l.contradicts.length) parts.push(`Contradicts ${l.contradicts.length}`);
  if (l.supports.length) parts.push(`Supports ${l.supports.length}`);
  return parts.join(" · ");
}
type Group = {
  key: string;
  subject: string;
  items: any[];
  linked: number;
  unresolved: [string, number][];
};
const groupId = (subject: string) =>
  "claims-" + (subject ? subject : "unclassified");
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
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<string>("");
  const listRef = useRef<HTMLDivElement>(null);
  const byKey = new Map<string, any>();
  for (const c of [...claims, ...references]) byKey.set(claimKey(c), c);
  const rejectionByKey = new Map(rejections.map((r) => [relKeyOf(r), r]));
  const lineageByKey = new Map<string, Lineage>();
  for (const c of claims) {
    const key = claimKey(c);
    lineageByKey.set(key, lineageOf(key, relations));
  }
  const current = claims.filter((c) => c.state === "current");
  const needle = filter.trim().toLowerCase();
  const matches = (c: any) =>
    !needle ||
    String(c.text ?? "")
      .toLowerCase()
      .includes(needle) ||
    String(c.subject ?? "")
      .toLowerCase()
      .includes(needle);
  const groupMap = new Map<string, Group>();
  for (const c of current) {
    if (!matches(c)) continue;
    const subject = c.subject ? String(c.subject) : "";
    let g = groupMap.get(subject);
    if (!g) {
      g = { key: subject, subject, items: [], linked: 0, unresolved: [] };
      groupMap.set(subject, g);
    }
    g.items.push(c);
    if (lineageByKey.get(claimKey(c))!.total) g.linked += 1;
  }
  for (const g of groupMap.values()) {
    if (!g.subject) continue;
    const counts = new Map<string, number>();
    for (const c of claims)
      if (c.subject === g.subject && c.state in unresolvedLabels)
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
        : a.subject.localeCompare(b.subject),
  );
  const linkedTotal = current.filter(
    (c) => lineageByKey.get(claimKey(c))!.total,
  ).length;
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  // Highlight the subject the reader is actually looking at. Re-registered
  // whenever the visible set changes, because filtering removes sections.
  const groupKeys = groups.map((g) => g.key).join("\u0000");
  useEffect(() => {
    const sections = listRef.current?.querySelectorAll("section[data-group]");
    if (!sections?.length) return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          seen.set(
            (entry.target as HTMLElement).dataset.group!,
            entry.isIntersecting,
          );
        for (const section of sections) {
          const key = (section as HTMLElement).dataset.group!;
          if (seen.get(key)) return setActive(key);
        }
      },
      { rootMargin: "-8% 0px -70% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [groupKeys]);
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
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          현재 주장 {current.length.toLocaleString()}개 · Subject{" "}
          {groups.length}개 · 관계가 연결된 주장 {linkedTotal}개.
          {linkedTotal > 0
            ? " 주장을 누르면 근거 원문과 리니지를 봅니다."
            : " 아직 통합이 연결한 관계가 없습니다."}
        </p>
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="이 페이지에서 찾기"
            aria-label="이 페이지에서 찾기"
            className="pl-9"
          />
        </div>
        {/* The empty case is the list's own message; saying it here too
            printed it twice. */}
        {needle && shown > 0 && (
          <p className="text-sm text-muted-foreground">
            {`${shown.toLocaleString()}개 일치 · Subject ${groups.length}개`}
          </p>
        )}
      </div>
      <div className="gap-8 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)]">
        <nav
          aria-label="목차"
          className="sticky top-6 hidden self-start xl:block"
        >
          <p className="mb-2 px-2 text-xs font-bold text-muted-foreground">
            Subjects
          </p>
          <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto">
            {groups.map((g) => (
              <li key={g.key}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-current={active === g.key ? "true" : undefined}
                  onClick={() =>
                    document
                      .getElementById(groupId(g.subject))
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className={`h-auto w-full justify-between gap-2 px-2 py-1.5 text-left font-normal ${
                    active === g.key ? "bg-accent font-bold" : ""
                  }`}
                >
                  <span className="truncate">{g.subject || "미분류"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {g.items.length}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-8" ref={listRef}>
          {!groups.length ? (
            <p className="text-muted-foreground">
              {needle
                ? "일치하는 주장이 없습니다."
                : "현재 유효한 주장이 없습니다."}
            </p>
          ) : null}
          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            // Never collapse a linked claim: preview covers at least all of them.
            const previewCount = Math.max(GROUP_PREVIEW, g.linked);
            const visible = isOpen ? g.items : g.items.slice(0, previewCount);
            const hidden = g.items.length - visible.length;
            return (
              <section key={g.key} id={groupId(g.subject)} data-group={g.key}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="scroll-mt-6 font-bold">
                    {g.subject || "미분류"}
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
                            {c.scope && c.scope !== "general" && (
                              <Badge variant="outline">{c.scope}</Badge>
                            )}
                            {lineage.total > 0 && (
                              <Badge variant="secondary">
                                <GitBranch />
                                {lineageSummary(lineage)}
                              </Badge>
                            )}
                            <Badge variant="outline">
                              <FileText />
                              Evidence {(c.evidence ?? []).length}
                            </Badge>
                          </div>
                          <p className="whitespace-pre-wrap leading-7">
                            {c.text}
                          </p>
                        </div>
                        <ChevronRight
                          className="mt-1 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </>
                    );
                    // Every claim opens: the chevron means "open this claim",
                    // not "has a relation". Reserving it for linked claims read
                    // as "this one has no evidence", which was never true —
                    // evidence and lineage are different things.
                    return (
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
        </div>
      </div>
      <Sheet open={open && !!selectedClaim} onOpenChange={setOpen}>
        <SheetContent side="right" className="gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b p-6 pr-12">
            <SheetTitle>Claim</SheetTitle>
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
  const evidence: { sourceId: string; lines: [number, number] }[] =
    claim.evidence ?? [];
  return (
    <div className="space-y-5 text-sm">
      <div>
        <h4 className="mb-2 font-semibold">Evidence · 근거 원문</h4>
        {evidence.length ? (
          <ul className="space-y-1">
            {evidence.map((e, i) => (
              <li key={`${e.sourceId}-${e.lines[0]}-${i}`}>
                <Link
                  href={`${root}/${claim.article_id}?revision=${claim.revision}&tab=evidence#${claim.anchor}`}
                  className="underline underline-offset-4"
                >
                  {e.lines[0] === e.lines[1]
                    ? `${e.lines[0]}행`
                    : `${e.lines[0]}–${e.lines[1]}행`}
                </Link>
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {e.sourceId.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            연결된 원문 구간이 없습니다. 사용자가 직접 남긴 진술이거나 본문만
            발행된 항목입니다.
          </p>
        )}
      </div>
      {backward.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">
            이 주장이 대체한 것 · Supersedes
          </h4>
          <ul>
            {backward.map((r) => row(r, "to", relationLabels[r.relation]))}
          </ul>
        </div>
      )}
      {forward.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">
            이 주장을 대체한 것 · Superseded by
          </h4>
          <ul>
            {forward.map((r) => row(r, "from", relationLabels[r.relation]))}
          </ul>
        </div>
      )}
      {contradicts.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">Contradicts</h4>
          <ul>
            {contradicts.map((r) =>
              row(r, isEnd(r, "from") ? "to" : "from", "Contradicts"),
            )}
          </ul>
        </div>
      )}
      {supports.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">Supports</h4>
          <ul>{supports.map((r) => row(r, "from", "Supports"))}</ul>
        </div>
      )}
      {empty && (
        <p className="text-muted-foreground">
          연결된 관계가 없습니다. 이 주장은 아직 아무것도 대체하지 않았고 아무
          것도 이 주장을 대체하지 않았습니다.
        </p>
      )}
    </div>
  );
}
