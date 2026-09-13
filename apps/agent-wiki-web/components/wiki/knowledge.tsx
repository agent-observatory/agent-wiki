"use client";
import { layerLabel, LAYER_NAMES } from "@/lib/layers";
import { KnowledgeHistory } from "./knowledge-history";
import { Pagination } from "./pagination";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Search, ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api, useApi } from "@/lib/api";
import { Heading, Loading, Failure, Empty, When } from "./common";
const kinds: Record<string, string> = {
  article: "문서",
  memory: "기억",
  glossary: "용어",
};
const types: Record<string, string> = {
  user_decision: "사용자 결정",
  observation: "관찰",
  ai_inference: "AI 해석",
  unconfirmed: "미확인",
  author_statement: "작성자 진술",
};
export function KnowledgeList() {
  const query = useSearchParams();
  const router = useRouter();
  const tab = query.get("tab") === "history" ? "history" : "knowledge";
  return (
    <>
      <Heading
        title={layerLabel("L3")}
        description="현재 지식과 그 근거·변경 이력을 확인합니다."
      />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          router.push(`?tab=${value}`, { scroll: false })
        }
      >
        <TabsList>
          <TabsTrigger value="knowledge">지식 목록</TabsTrigger>
          <TabsTrigger value="history">반영 이력</TabsTrigger>
        </TabsList>
        <TabsContent value="knowledge" className="pt-6">
          <KnowledgeArticles />
        </TabsContent>
        <TabsContent value="history" className="pt-6">
          <KnowledgeHistory />
        </TabsContent>
      </Tabs>
    </>
  );
}
function KnowledgeArticles() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useSearchParams();
  const router = useRouter();
  const q = query.get("q") ?? "";
  const tag = query.get("tag") ?? "";
  const filter = new URLSearchParams(query);
  if (q) filter.set("q", q);
  if (tag) filter.set("tag", tag);
  const { data, error } = useApi(
    `/api/workspaces/${workspaceId}/articles?${filter}`,
  );
  const root = `/workspaces/${workspaceId}/knowledge`;
  return (
    <>
      <form
        className="mb-6 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const s = new URLSearchParams();
          if (f.get("q")) s.set("q", String(f.get("q")));
          if (f.get("tag")) s.set("tag", String(f.get("tag")));
          router.push(root + "?" + s);
        }}
      >
        <Input
          key={"q" + q}
          name="q"
          aria-label="지식 검색"
          placeholder="결정·용어·키워드 검색"
          defaultValue={q}
          className="min-w-40 flex-1"
        />
        <Input
          key={"tag" + tag}
          name="tag"
          aria-label="태그 필터"
          placeholder="프로젝트 태그"
          defaultValue={tag}
          className="w-44"
        />
        <Button variant="outline">
          <Search />
          검색
        </Button>
      </form>
      {error ? (
        <Failure error={error} />
      ) : !data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty>
          {data.queryStatus === "needs_terms"
            ? "검색할 대상이나 핵심어를 추가하세요."
            : "아직 찾은 지식이 없습니다."}
        </Empty>
      ) : (
        <div className="divide-y border-y">
          {data.items.map((a: any) => (
            <Link
              className="group block py-5 hover:bg-accent/50 px-3 -mx-3 rounded-md"
              href={`${root}/${a.id}`}
              key={a.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold group-hover:underline">
                  {a.title}
                </span>
                <Badge variant="secondary">{kinds[a.kind]}</Badge>
                <Badge variant="outline">
                  {a.reviewPending ? "검토 전" : "검토 완료"}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-muted-foreground">
                {a.content.replace(/[#*`]/g, "").slice(0, 180)}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>근거 {a.evidence_count}개</span>
                <Badge variant="outline">Version {a.revision}</Badge>
                <When value={a.updated_at} />
                {a.tags.map((t: string) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
      <Pagination data={data?.pagination} label={LAYER_NAMES.L3} />
    </>
  );
}
export function KnowledgeDetail() {
  const { workspaceId, id } = useParams<{ workspaceId: string; id: string }>();
  const query = useSearchParams();
  const router = useRouter();
  const revision = query.get("revision");
  const root = `/workspaces/${workspaceId}`;
  const {
    data: a,
    error,
    reload,
  } = useApi(
    `/api/workspaces/${workspaceId}/articles/${id}${revision ? "/revisions/" + revision : ""}`,
  );
  if (error) return <Failure error={error} />;
  if (!a) return <Loading />;
  const old = a.revision !== a.currentRevision;
  return (
    <>
      <Link
        href={root + "/knowledge"}
        className="inline-flex items-center gap-2 mb-6 text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
        {layerLabel("L3")}
      </Link>
      <Heading title={a.title} />
      <div className="mb-6 flex flex-wrap gap-2 items-center">
        <Badge variant="secondary">{kinds[a.kind]}</Badge>
        <Badge variant="outline">
          {a.producer.type === "agent" ? "에이전트 작성" : "직접 작성"}
        </Badge>
        <Badge variant="outline">
          {a.reviewPending ? "검토 전" : "검토 완료"}
        </Badge>
        {a.tags.map((t: string) => (
          <Link href={root + "/knowledge?tag=" + encodeURIComponent(t)} key={t}>
            <Badge variant="secondary">#{t}</Badge>
          </Link>
        ))}
        <Select
          value={String(a.revision)}
          onValueChange={(r) =>
            router.push(`${root}/knowledge/${id}?revision=${r}`)
          }
        >
          <SelectTrigger className="w-32" aria-label="문서 Version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {a.revisions.map((r: any) => (
              <SelectItem key={r.revision} value={String(r.revision)}>
                Version {r.revision}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {old && (
        <p className="mb-5 rounded-lg border p-3">
          과거 Version입니다.{" "}
          <Link className="underline" href={`${root}/knowledge/${id}`}>
            최신 Version {a.currentRevision} 보기
          </Link>
        </p>
      )}
      {a.supersededBy.length > 0 && (
        <p className="mb-5 rounded-lg border p-3">
          이 결정은 대체됐습니다.{" "}
          {a.supersededBy.map((x: any) => (
            <Link
              key={x.id}
              className="underline mr-2"
              href={`${root}/knowledge/${x.id}`}
            >
              {x.title}
            </Link>
          ))}
        </p>
      )}

      <Tabs
        value={query.get("tab") ?? "content"}
        onValueChange={(tab) => {
          const next = new URLSearchParams(query.toString());
          next.set("tab", tab);
          router.replace(`${root}/knowledge/${id}?${next}`, { scroll: false });
        }}
      >
        <TabsList>
          <TabsTrigger value="content">본문</TabsTrigger>
          <TabsTrigger value="evidence">근거·리니지</TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="mt-6">
          {a.claims.some((c: any) =>
            ["superseded", "retracted", "conflicted"].includes(c.state),
          ) && (
            <p className="mb-4 text-sm text-muted-foreground">
              변경되거나 충돌하는 주장이 포함되어 있습니다. 근거·리니지에서 현재
              상태를 확인하세요.
            </p>
          )}
          <article className="prose-wiki max-w-3xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {a.content}
            </ReactMarkdown>
          </article>
          {a.links.length > 0 && (
            <section className="mt-10 border-t pt-6">
              <h2 className="font-bold mb-3">연결된 지식</h2>
              {a.links.map((x: any) => (
                <Link
                  className="block py-2 underline"
                  key={x.id + x.relation}
                  href={`${root}/knowledge/${x.id}`}
                >
                  {x.title}
                  {x.relation === "supersedes" ? " · 이전 결정" : ""}
                </Link>
              ))}
            </section>
          )}
        </TabsContent>
        <TabsContent value="evidence" className="mt-6 space-y-6">
          <div className="rounded-lg border p-5">
            <h2 className="font-bold">정제·작성 기록</h2>
            <p className="mt-2 text-muted-foreground">
              {a.producer.client} · <When value={a.refined_at} />
            </p>
            {a.reason && <p className="mt-2">{a.reason}</p>}
            {a.producer.skillVersion && (
              <p className="text-xs mt-2">Skill {a.producer.skillVersion}</p>
            )}
          </div>
          {(a.claimRelations ?? []).length > 0 && (
            <section className="rounded-lg border p-5 space-y-3">
              <h2 className="font-bold">주장 변경 이력</h2>
              {a.claimRelations.map((r: any, i: number) => {
                const outgoing =
                  r.from_article_id === a.id && r.from_revision === a.revision;
                const id = outgoing ? r.to_article_id : r.from_article_id;
                const revision = outgoing ? r.to_revision : r.from_revision;
                const label = (
                  {
                    supersedes: outgoing
                      ? "대체한 이전 주장"
                      : "이 주장을 대체한 결정",
                    retracts: outgoing
                      ? "철회한 이전 주장"
                      : "이 주장을 철회한 결정",
                    contradicts: "충돌하는 주장",
                    supports: "뒷받침하는 주장",
                  } as Record<string, string>
                )[r.relation];
                return (
                  <Link
                    key={i}
                    className="block underline"
                    href={`${root}/knowledge/${id}?revision=${revision}`}
                  >
                    {label} · Version {revision}
                  </Link>
                );
              })}
            </section>
          )}
          {a.claims.map((c: any) => (
            <section key={c.anchor} className="rounded-lg border p-5">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{types[c.type]}</Badge>
                {c.state !== "current" && (
                  <Badge variant="secondary">
                    {(
                      {
                        proposed: "검토 의견",
                        superseded: "대체됨",
                        retracted: "철회됨",
                        conflicted: "미해결 충돌",
                        unconfirmed: "미확인",
                      } as Record<string, string>
                    )[c.state] ?? c.state}
                  </Badge>
                )}
                {c.scope && <Badge variant="outline">{c.scope}</Badge>}
              </div>
              <p className="my-4 leading-7 whitespace-pre-wrap">{c.text}</p>
              {!c.evidence.length ? (
                <p className="text-muted-foreground">
                  연결된 원문이 없는 작성자 진술입니다.
                </p>
              ) : (
                c.evidence.map((e: any) => (
                  <div
                    key={e.source_id + e.line_start}
                    className="mt-4 border-l-2 pl-4"
                  >
                    {e.unavailable ? (
                      <span className="text-destructive">
                        삭제된 원문 · 근거 사용 불가
                      </span>
                    ) : (
                      <Link
                        className="inline-flex gap-2 items-center underline"
                        href={`${root}/sources/${e.source_id}?revision=${e.source_revision}&start=${e.line_start}&end=${e.line_end}`}
                      >
                        {e.name} · {e.line_start}–{e.line_end}줄
                        <ExternalLink className="size-3" />
                      </Link>
                    )}
                    <blockquote className="mt-2 whitespace-pre-wrap text-muted-foreground">
                      {e.quote}
                    </blockquote>
                  </div>
                ))
              )}
            </section>
          ))}
        </TabsContent>
      </Tabs>
    </>
  );
}
