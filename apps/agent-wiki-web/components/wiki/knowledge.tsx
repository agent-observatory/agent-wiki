"use client";
import { layerLabel, LAYER_NAMES } from "@/lib/layers";
import { Pagination } from "./pagination";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Plus,
  Search,
  ArrowLeft,
  ExternalLink,
  Check,
  Trash2,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
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
  const [create, setCreate] = useState(false);
  const root = `/workspaces/${workspaceId}/knowledge`;
  return (
    <>
      <Heading
        title={layerLabel("L3")}
        description="다음 작업에서 다시 꺼내 쓸 결정과 기억입니다."
        action={
          <Button onClick={() => setCreate(true)}>
            <Plus />
            직접 작성
          </Button>
        }
      />
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
          {data.queryStatus !== "needs_terms" && (
            <p className="mt-3">
              <Link
                className="underline"
                href={`/workspaces/${workspaceId}/guide`}
              >
                에이전트로 기록을 쌓는 방법
              </Link>
            </p>
          )}
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
                  {a.reviewed_at ? "검토됨" : "검토 전"}
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
      <Editor
        open={create}
        close={() => setCreate(false)}
        workspaceId={workspaceId}
      />
    </>
  );
}
function Editor({
  open,
  close,
  workspaceId,
  article,
}: {
  open: boolean;
  close: () => void;
  workspaceId: string;
  article?: any;
}) {
  const router = useRouter();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState(article?.kind ?? "article");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const last = useRef("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{article ? "지식 정정" : "직접 작성"}</DialogTitle>
        <DialogDescription>
          직접 작성한 내용은 작성자 진술로 보관합니다. 기존 주장과 일치하는
          근거는 유지하며 새 Version은 검토 전으로 저장합니다.
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const content = String(f.get("content"));
            const payload = {
              title: String(f.get("title")),
              content,
              kind,
              folder: String(f.get("folder")),
              tags: String(f.get("tags"))
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              aliases: article?.aliases ?? [],
              baseRevision: article?.revision ?? null,
              claims: (article?.claims ?? [])
                .filter(
                  (c: any) =>
                    content.includes(c.text) &&
                    !c.evidence.some((e: any) => e.unavailable),
                )
                .map((c: any) => ({
                  anchor: c.anchor,
                  text: c.text,
                  type: c.type,
                  subject: c.subject,
                  scope: c.scope,
                  state: c.state,
                  evidence: c.evidence.map((e: any) => ({
                    sourceId: e.source_id,
                    revision: e.source_revision,
                    lines: [e.line_start, e.line_end],
                    quote: e.quote,
                  })),
                })),
              supersedes:
                article?.links
                  .filter((l: any) => l.relation === "supersedes")
                  .map((l: any) => l.id) ?? [],
              links:
                article?.links
                  .filter((l: any) => l.relation === "links_to")
                  .map((l: any) => l.id) ?? [],
            };
            const body = JSON.stringify(payload);
            let requestKey = key;
            if (last.current && last.current !== body) {
              requestKey = crypto.randomUUID();
              setKey(requestKey);
            }
            last.current = body;
            setBusy(true);
            setError(undefined);
            try {
              const r = await api(
                `/api/workspaces/${workspaceId}/articles${article ? "/" + article.id : ""}`,
                {
                  method: article ? "PUT" : "POST",
                  headers: { "Idempotency-Key": requestKey },
                  body,
                },
              );
              close();
              router.push(
                `/workspaces/${workspaceId}/knowledge/${r.id}?revision=${r.revision}`,
              );
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block space-y-2">
            <span>제목</span>
            <Input
              name="title"
              defaultValue={article?.title}
              required
              maxLength={200}
            />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="space-y-2">
              <span>종류</span>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger aria-label="문서 종류">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(kinds).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex-1 space-y-2">
              <span>폴더</span>
              <Input name="folder" defaultValue={article?.folder} />
            </label>
          </div>
          <label className="block space-y-2">
            <span>태그 · 쉼표로 구분</span>
            <Input name="tags" defaultValue={article?.tags.join(", ")} />
          </label>
          <label className="block space-y-2">
            <span>Markdown 본문</span>
            <Textarea
              name="content"
              rows={12}
              className="min-h-64"
              defaultValue={article?.content}
              required
            />
          </label>
          {!!error && <Failure error={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              취소
            </Button>
            <Button disabled={busy}>{busy ? "저장 중…" : "저장"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [failed, setFailed] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  if (error) return <Failure error={error} />;
  if (!a) return <Loading />;
  const old = a.revision !== a.currentRevision;
  async function review() {
    try {
      await api(`/api/workspaces/${workspaceId}/articles/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: a.revision }),
      });
      reload();
    } catch (e) {
      setFailed(e);
    }
  }
  return (
    <>
      <Link
        href={root + "/knowledge"}
        className="inline-flex items-center gap-2 mb-6 text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
        {layerLabel("L3")}
      </Link>
      <Heading
        title={a.title}
        action={
          !old && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil />
                정정
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="지식 삭제"
                onClick={() => setRemove(true)}
              >
                <Trash2 />
              </Button>
            </div>
          )
        }
      />
      <div className="mb-6 flex flex-wrap gap-2 items-center">
        <Badge variant="secondary">{kinds[a.kind]}</Badge>
        <Badge variant="outline">
          {a.producer.type === "agent" ? "에이전트 작성" : "직접 작성"}
        </Badge>
        <Badge variant="outline">{a.reviewed_at ? "검토됨" : "검토 전"}</Badge>
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
      {!!failed && <Failure error={failed} />}
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
          {!old && !a.reviewed_at && (
            <Button variant="outline" onClick={review}>
              <Check />이 Version을 검토했음
            </Button>
          )}
        </TabsContent>
      </Tabs>
      <Editor
        key={a.revision}
        open={edit}
        close={() => setEdit(false)}
        workspaceId={workspaceId}
        article={a}
      />
      <AlertDialog open={remove} onOpenChange={setRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 지식을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              검색과 Context에서 제외됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await api(`/api/workspaces/${workspaceId}/articles/${id}`, {
                    method: "DELETE",
                    body: JSON.stringify({ revision: a.revision }),
                  });
                  router.push(root + "/knowledge");
                } catch (e) {
                  setFailed(e);
                  setRemove(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
