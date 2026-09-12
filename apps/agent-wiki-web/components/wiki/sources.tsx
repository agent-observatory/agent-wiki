"use client";
import { Pagination } from "./pagination";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/lib/api";
import { Heading, Empty, Failure, Loading, When } from "./common";
export function SourceList() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useSearchParams();
  const { data, error } = useApi(
    `/api/workspaces/${workspaceId}/source-sessions?${query}`,
  );
  return (
    <>
      <Heading
        title="수집 자료"
        description="지식의 근거가 되는 대화·문서·코드의 보관본입니다."
      />
      {error ? (
        <Failure error={error} />
      ) : !data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty>아직 수집한 자료가 없습니다. Collector를 연결해 주세요.</Empty>
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
