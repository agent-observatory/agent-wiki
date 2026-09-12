"use client";
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
  const { data, error } = useApi(
    `/api/workspaces/${workspaceId}/source-records`,
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
        title="원천 자료"
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
          보관한 원문이 없습니다. 에이전트로 기록을 정제할 때 원문부터
          등록합니다.
        </Empty>
      ) : (
        <div className="divide-y border-y">
          {data.items.map((s: any) => (
            <Link
              key={s.id}
              href={`/workspaces/${workspaceId}/sources/${s.id}?revision=1`}
              className="block py-5 hover:bg-accent/50"
            >
              <h2 className="font-bold">{s.name}</h2>
              <p className="mt-2 text-muted-foreground break-all">
                {s.origin || "위치 미기록"}
              </p>
              <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                <span>{s.line_count}줄</span>
                <When value={s.created_at} />
                {s.masked && <Badge variant="outline">마스킹 보관본</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-auto">
          <DialogTitle>원문 보관</DialogTitle>
          <DialogDescription>
            이 단계는 원문을 저장합니다. 지식 정제는 사용 중인 에이전트가
            수행합니다.
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
                router.push(
                  `/workspaces/${workspaceId}/sources/${s.id}?revision=1`,
                );
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
  const revision = q.get("revision") ?? "1";
  const filter = new URLSearchParams();
  if (q.get("start")) filter.set("start", q.get("start")!);
  if (q.get("end")) filter.set("end", q.get("end")!);
  const { data: s, error } = useApi(
    `/api/workspaces/${workspaceId}/source-records/${id}/revisions/${revision}?${filter}`,
  );
  if (error) return <Failure error={error} />;
  if (!s) return <Loading />;
  return (
    <>
      <Link
        href={`/workspaces/${workspaceId}/sources`}
        className="mb-6 inline-flex gap-2 items-center text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
        원천 자료
      </Link>
      <Heading
        title={s.name}
        description={`${s.start}–${s.end}줄 · 보관 개정 r${s.revision}`}
      />
      <div className="mb-6 space-y-2 text-sm text-muted-foreground">
        <p className="break-all">원래 위치: {s.origin || "미기록"}</p>
        <p>
          보관 시점: <When value={s.created_at} />
        </p>
        {s.masked && (
          <Badge variant="outline">민감한 패턴을 마스킹한 보관본</Badge>
        )}
        {s.metadata?.rawUploadId && (
          <p>
            이미지 분석을 생략한 텍스트 보기 ·{" "}
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
        {filter.size > 0 && (
          <Link
            className="block underline"
            href={`/workspaces/${workspaceId}/sources/${id}?revision=${revision}`}
          >
            원문 전체 보기
          </Link>
        )}
      </div>
      <div className="rounded-lg border overflow-x-auto py-3">
        {s.text.split("\n").map((line: string, i: number) => (
          <div key={i} className="flex min-w-0 font-mono text-sm leading-7">
            <span className="w-14 shrink-0 select-none px-3 text-right text-muted-foreground border-r">
              {s.start + i}
            </span>
            <span className="px-4 whitespace-pre-wrap break-words min-w-0">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
