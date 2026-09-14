"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { When } from "./common";
// Structured claims list + lineage panel, drawn from the same Wiki Page
// Version snapshot the markdown already used (no new API, no new storage).
// docs/l2-l3-memory.md#knowledge-화면--현재-주장-목록과-리니지-패널.
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
function claimKey(c: ClaimRef) {
  return `${c.article_id}:${c.revision}:${c.anchor}`;
}
function relationRef(
  r: {
    from_article_id: string;
    from_revision: number;
    from_anchor: string;
    to_article_id: string;
    to_revision: number;
    to_anchor: string;
    relation: string;
  },
  side: "from" | "to",
): ClaimRef {
  return side === "from"
    ? { article_id: r.from_article_id, revision: r.from_revision, anchor: r.from_anchor }
    : { article_id: r.to_article_id, revision: r.to_revision, anchor: r.to_anchor };
}
function relKeyOf(r: {
  from_article_id: string;
  from_revision: number;
  from_anchor: string;
  to_article_id: string;
  to_revision: number;
  to_anchor: string;
  relation: string;
}) {
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
export function KnowledgeClaims({
  snapshot,
  root,
}: {
  snapshot: any;
  root: string;
}) {
  const claims: any[] = snapshot.claims ?? [];
  const references: any[] = snapshot.references ?? [];
  const relations: any[] = snapshot.relations ?? [];
  const rejections: any[] = snapshot.rejections ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const byKey = new Map<string, any>();
  for (const c of [...claims, ...references]) byKey.set(claimKey(c), c);
  const rejectionByKey = new Map(rejections.map((r) => [relKeyOf(r), r]));
  const current = claims.filter((c) => c.state === "current");
  const groups = new Map<string, any[]>();
  for (const c of current) {
    const key = c.subject && c.scope ? `${c.subject} ${c.scope}` : "";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  const unresolvedFor = (subject: string, scope: string) =>
    claims.filter(
      (c) =>
        c.subject === subject &&
        c.scope === scope &&
        c.state in unresolvedLabels,
    );
  const orderedKeys = [...groups.keys()].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
  );
  const selectedClaim = selected ? byKey.get(selected) : null;
  return (
    <div className="flex gap-8">
      <div className="min-w-0 flex-1 space-y-8">
        {!orderedKeys.length && (
          <p className="text-muted-foreground">현재 유효한 주장이 없습니다.</p>
        )}
        {orderedKeys.map((key) => {
          const items = groups.get(key)!;
          const [subject, scope] = key ? key.split(" ") : ["", ""];
          const unresolved = key ? unresolvedFor(subject, scope) : [];
          const counts = new Map<string, number>();
          for (const u of unresolved)
            counts.set(u.state, (counts.get(u.state) ?? 0) + 1);
          return (
            <section key={key || "미분류"}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="font-bold">
                  {subject && scope ? `${subject} · ${scope}` : "미분류"}
                </h2>
                {[...counts.entries()].map(([state, n]) => (
                  <Badge variant="secondary" key={state}>
                    {unresolvedLabels[state]} {n}건
                  </Badge>
                ))}
              </div>
              <div className="space-y-3">
                {items.map((c) => {
                  const key = claimKey(c);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelected(key === selected ? null : key)}
                      className={`block w-full rounded-lg border p-4 text-left transition-colors ${
                        selected === key
                          ? "border-primary bg-accent/40"
                          : "hover:bg-accent/30"
                      }`}
                    >
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {typeLabels[c.type] ?? c.type}
                        </Badge>
                      </div>
                      <p className="whitespace-pre-wrap leading-7">{c.text}</p>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {selectedClaim && (
        <aside className="w-80 shrink-0 rounded-lg border p-5">
          <h3 className="mb-4 font-bold">리니지</h3>
          <LineagePanel
            claim={selectedClaim}
            relations={relations}
            byKey={byKey}
            rejectionByKey={rejectionByKey}
            root={root}
          />
        </aside>
      )}
    </div>
  );
}
function LineagePanel({
  claim,
  relations,
  byKey,
  rejectionByKey,
  root,
}: {
  claim: any;
  relations: any[];
  byKey: Map<string, any>;
  rejectionByKey: Map<string, any>;
  root: string;
}) {
  const key = claimKey(claim);
  const isEnd = (r: any, side: "from" | "to") =>
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
  const row = (r: any, otherSide: "from" | "to", label: string) => {
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
    !backward.length && !forward.length && !contradicts.length && !supports.length;
  return (
    <div className="space-y-5 text-sm">
      {backward.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">이 주장이 대체한 것</h4>
          <ul>{backward.map((r) => row(r, "to", relationLabels[r.relation]))}</ul>
        </div>
      )}
      {forward.length > 0 && (
        <div>
          <h4 className="mb-2 font-semibold">이 주장을 대체한 것</h4>
          <ul>{forward.map((r) => row(r, "from", relationLabels[r.relation]))}</ul>
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
      {empty && <p className="text-muted-foreground">연결된 관계가 없습니다.</p>}
    </div>
  );
}
