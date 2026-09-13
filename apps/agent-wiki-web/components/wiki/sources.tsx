"use client";
import { layerLabel, LAYER_NAMES } from "@/lib/layers";
import { Pagination } from "./pagination";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/lib/api";
import { Heading, Empty, Failure, Loading, When } from "./common";
export function SourceList() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useSearchParams();
  const { data, error } = useApi(
    `/api/workspaces/${workspaceId}/source-sessions?${query}`,
    15000,
  );
  return (
    <>
      <Heading
        title={layerLabel("L1")}
        description="지식의 근거가 되는 대화·문서·코드의 보관본입니다."
      />
      {error ? (
        <Failure error={error} />
      ) : !data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty>아직 수집한 자료가 없습니다. Collector를 연결해 주세요.</Empty>
      ) : (
        <div className="divide-y border-y">
          {data.items.map((s: any) => (
            <Link
              key={s.id}
              href={`/workspaces/${workspaceId}/sources/${s.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3 hover:bg-accent/50"
            >
              <h2
                className="min-w-0 basis-full sm:basis-auto sm:flex-1 truncate text-sm font-medium"
                title={s.name}
              >
                {s.name}
              </h2>
              <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs text-muted-foreground">
                <span title="사용자 발언·에이전트 응답·도구 호출·결과의 개수">
                  {Number(s.event_count).toLocaleString()}개 기록
                </span>
                <span>
                  마지막 수집 <When value={s.created_at} compact />
                </span>
                {s.masked && <Badge variant="outline">마스킹 보관본</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
      <Pagination data={data?.pagination} label={LAYER_NAMES.L1} />
    </>
  );
}
export function SourceDetail() {
  const { workspaceId, id } = useParams<{ workspaceId: string; id: string }>();
  const q = useSearchParams();
  const base = `/api/workspaces/${workspaceId}/source-records/${id}`;
  const { data: s, error } = useApi(base + "/info", 15000);
  if (error) return <Failure error={error} />;
  if (!s) return <Loading />;
  return (
    <>
      <Link
        href={`/workspaces/${workspaceId}/sources`}
        className="mb-6 inline-flex gap-2 items-center text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
        {layerLabel("L1")}
      </Link>
      <Heading title={s.name} description="보관된 기록과 근거를 확인합니다." />
      <dl className="mb-6 flex flex-wrap gap-x-8 gap-y-4 border-y py-4 text-sm">
        <div>
          <dt className="text-muted-foreground">수집 횟수</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {s.collection.count.toLocaleString()}회
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">마지막 수집</dt>
          <dd className="mt-1 font-medium">
            {s.collection.last_collected_at ? (
              <When value={s.collection.last_collected_at} />
            ) : (
              "기록 없음"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">보관 기록</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {s.collection.event_count.toLocaleString()}개
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">압축 보관 용량</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {(s.collection.stored_bytes / 1024 / 1024).toFixed(2)} MB
          </dd>
        </div>
      </dl>
      <SourceHistory key={id} base={base} />
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
        key={[id, q.get("start"), q.get("end"), q.get("revision")].join(":")}
        base={base}
        evidence={q.has("start") ? q.toString() : null}
        revision={q.get("revision") ?? "1"}
      />
    </>
  );
}
type CollectionHistory = {
  items: {
    id: string;
    collected_at: string;
    line_count: number;
    event_count: number;
    initial: boolean;
  }[];
  pagination: { page: number; pageSize: number; hasNext: boolean };
};
function SourceHistory({ base }: { base: string }) {
  const query = useSearchParams();
  const [opened, setOpened] = useState(false);
  const { data, error } = useApi<CollectionHistory>(
    opened
      ? `${base}/collection-history?historyPage=${query.get("historyPage") ?? "1"}&pageSize=${query.get("pageSize") ?? "25"}`
      : null,
  );
  return (
    <section className="mb-6 border-b pb-4">
      <Button
        variant="ghost"
        className="-ml-3"
        aria-expanded={opened}
        aria-controls="collection-history"
        onClick={() => setOpened(!opened)}
      >
        <ChevronDown
          className={`size-4 transition-transform ${opened ? "rotate-180" : ""}`}
        />
        수집 이력
      </Button>
      {opened && (
        <div id="collection-history" className="pt-2">
          {error ? (
            <Failure error={error} />
          ) : !data ? (
            <Loading />
          ) : !data.items.length ? (
            <Empty>수집 이력이 없습니다.</Empty>
          ) : (
            <>
              <ul className="divide-y">
                {data.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm"
                  >
                    <span className="text-muted-foreground">
                      <When value={item.collected_at} />
                    </span>
                    {item.initial && <Badge variant="outline">최초 수집</Badge>}
                    <span className="tabular-nums">
                      {item.event_count.toLocaleString()}개 기록 추가
                    </span>
                  </li>
                ))}
              </ul>
              <Pagination
                data={data.pagination}
                pageKey="historyPage"
                label="수집 이력"
              />
            </>
          )}
        </div>
      )}
    </section>
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
