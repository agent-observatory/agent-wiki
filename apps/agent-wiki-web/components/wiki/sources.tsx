"use client";
import { Pagination } from "./pagination";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useState, useRef } from "react";
import { Plus, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { api, useApi } from "@/lib/api";
import { Heading, Empty, Failure, Loading, When } from "./common";
export function SourceList() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const query = useSearchParams();
  const { data, error } = useApi(
    `/api/workspaces/${workspaceId}/source-sessions?${query}`,
  );
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [failed, setFailed] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const last = useRef({ body: "", key: "" });
  return (
    <>
      <Heading
        title="수집 자료"
        description="지식의 근거가 되는 대화·문서·코드의 보관본입니다."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            원문 보관
          </Button>
        }
      />
      {error ? (
        <Failure error={error} />
      ) : !data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty>
          아직 수집한 자료가 없습니다. Collector를 연결하거나 문서를 직접
          보관하세요.
        </Empty>
      ) : (
        <div className="divide-y border-y overflow-x-auto">
          {data.items.map((s: any) => (
            <Link
              key={s.id}
              href={`/workspaces/${workspaceId}/sources/${s.id}`}
              className="flex min-w-[32rem] items-center gap-4 py-3 hover:bg-accent/50"
            >
              <h2
                className="min-w-0 flex-1 truncate text-sm font-medium"
                title={s.name}
              >
                {s.name}
              </h2>
              <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs text-muted-foreground">
                <span>{s.line_count}줄</span>
                <When value={s.created_at} />
                {s.masked && <Badge variant="outline">마스킹 보관본</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
      <Pagination data={data?.pagination} label="수집 자료" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-auto">
          <DialogTitle>원문 보관</DialogTitle>
          <DialogDescription>
            자료를 보관합니다. 지식 반영은 별도의 정제 작업에서 진행합니다.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const body = JSON.stringify({
                name,
                text,
                origin: String(f.get("origin")),
                kind: "document",
              });
              if (last.current.body !== body)
                last.current = { body, key: crypto.randomUUID() };
              setBusy(true);
              try {
                const s = await api(
                  `/api/workspaces/${workspaceId}/source-records`,
                  {
                    method: "POST",
                    headers: { "Idempotency-Key": last.current.key },
                    body,
                  },
                );
                setOpen(false);
                router.push(`/workspaces/${workspaceId}/sources/${s.id}`);
              } catch (e) {
                setFailed(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block space-y-2">
              <span>이름</span>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span>원래 위치</span>
              <Input name="origin" placeholder="문서 주소 또는 대화의 위치" />
            </label>
            <Input
              type="file"
              aria-label="원문 파일"
              accept=".txt,.md,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  if (f.size > 100000) {
                    setFailed(new Error("too large"));
                    return;
                  }
                  setName(f.name);
                  setText(await f.text());
                }
              }}
            />
            <label className="block space-y-2">
              <span>본문 · 100KB 이하</span>
              <Textarea
                className="min-h-60"
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            {!!failed && <Failure error={failed} />}
            <Button disabled={busy}>{busy ? "보관 중…" : "보관"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function SourceDetail() {
  const { workspaceId, id } = useParams<{ workspaceId: string; id: string }>();
  const q = useSearchParams();
  const base = `/api/workspaces/${workspaceId}/source-records/${id}`;
  const { data: s, error } = useApi(base + "/info");
  if (error) return <Failure error={error} />;
  if (!s) return <Loading />;
  return (
    <>
      <Link
        href={`/workspaces/${workspaceId}/sources`}
        className="mb-6 inline-flex gap-2 items-center text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
        수집 자료
      </Link>
      <Heading title={s.name} description="보관된 기록과 근거를 확인합니다." />
      <div className="mb-6 space-y-2 text-sm text-muted-foreground">
        <Badge variant="outline">보관 Version {s.revision}</Badge>
        <p className="break-all">원래 위치: {s.origin || "미기록"}</p>
        <p>
          보관 시점: <When value={s.created_at} />
        </p>
        {s.masked && <Badge variant="outline">마스킹 보관본</Badge>}
        {s.metadata?.rawUploadId && (
          <p>
            <a
              className="underline"
              href={`/api/workspaces/${workspaceId}/collection/uploads/${s.metadata.rawUploadId}/raw`}
              target="_blank"
              rel="noreferrer"
            >
              원본 보관 정보·다운로드
            </a>
          </p>
        )}
      </div>
      <SourceReader
        key={id + q.toString()}
        base={base}
        evidence={q.has("start") ? q.toString() : null}
        revision={q.get("revision") ?? "1"}
      />
    </>
  );
}
function SourceReader({
  base,
  evidence,
  revision,
}: {
  base: string;
  evidence: string | null;
  revision: string;
}) {
  const [opened, setOpened] = useState(!!evidence),
    [page, setPage] = useState(1);
  const { data, error } = useApi(
    !opened
      ? null
      : evidence
        ? `${base}/revisions/${revision}?${evidence}`
        : `${base}/session-text?page=${page}`,
  );
  if (!opened)
    return (
      <Button variant="outline" onClick={() => setOpened(true)}>
        전체 기록 보기
      </Button>
    );
  return (
    <div className="space-y-4">
      {error ? (
        <Failure error={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          {evidence && (
            <p className="text-xs text-muted-foreground">
              근거 {data.start}–{data.end}줄
            </p>
          )}
          <div className="rounded-lg border p-4 space-y-2 text-sm font-mono break-words whitespace-pre-wrap">
            {data.text.split("\n").map((line: string, i: number) => {
              let text = line;
              if (data.projected) {
                try {
                  const entry = JSON.parse(line);
                  text = entry.text;
                } catch {}
              }
              return <div key={i}>{text || " "}</div>;
            })}
          </div>
          {!evidence && (
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                이전 기록
              </Button>
              <span className="text-xs text-muted-foreground">
                {page}페이지
              </span>
              <Button
                variant="outline"
                disabled={!data.hasNext}
                onClick={() => setPage(page + 1)}
              >
                다음 기록
              </Button>
            </div>
          )}
          {evidence && (
            <Link className="text-sm underline" href="?">
              전체 기록 보기
            </Link>
          )}
        </>
      )}
    </div>
  );
}
