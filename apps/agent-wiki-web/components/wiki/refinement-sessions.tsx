"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "./pagination";
import { Empty, Failure, Loading, When } from "./common";
import { waitingReasons } from "./refinement-progress";

type Schedule = { reason: string; nextAttemptAt: string | null };
type Props = {
  workspaceId: string;
  schedule: Schedule;
  reasons: Record<string, string>;
  statuses: Record<string, string>;
  onRetry: () => void;
};
type Session = {
  id: string;
  name: string;
  total: number;
  pending: number;
  running: number;
  failed: number;
  completed: number;
  retrying: number;
  chunks_done: number;
  chunks_total: number;
  unplanned: number;
};
type Page = { page: number; pageSize: number; hasNext: boolean };
export function RefinementSessions(props: Props) {
  const query = useSearchParams(),
    router = useRouter();
  const { data, error, reload } = useApi<{
    items: Session[];
    total: number;
    pagination: Page;
  }>(
    `/api/workspaces/${props.workspaceId}/refinement-sessions?${query}`,
    15000,
  );
  const selected = query.get("session");
  function toggle(id: string) {
    const next = new URLSearchParams(query);
    if (selected === id) next.delete("session");
    else next.set("session", id);
    next.delete("detailPage");
    router.push(`?${next}`, { scroll: false });
  }
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <p className="mb-4 text-xs text-muted-foreground">
        전체 {data.total.toLocaleString()}개 세션 · 상태별 수는 정제 작업 기준
      </p>
      {!data.items.length ? (
        <Empty>수집한 원문이 들어오면 정제 작업이 표시됩니다.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>세션</TableHead>
              <TableHead className="text-right">대기</TableHead>
              <TableHead className="text-right">진행 중</TableHead>
              <TableHead className="text-right">실패</TableHead>
              <TableHead className="text-right">완료</TableHead>
              <TableHead>청크 반영</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((session) => (
              <Fragment key={session.id}>
                <TableRow>
                  <TableCell className="min-w-48 max-w-xs whitespace-normal break-words">
                    <Link
                      className="underline"
                      href={`/workspaces/${props.workspaceId}/sources/${session.id}`}
                    >
                      {session.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {session.pending.toLocaleString()}
                    {session.retrying > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        재시도 {session.retrying}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {session.running.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {session.failed > 0 ? (
                      <Badge variant="destructive">{session.failed}</Badge>
                    ) : (
                      "0"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {session.completed.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {session.chunks_total > 0
                      ? `${session.chunks_done.toLocaleString()} / ${session.chunks_total.toLocaleString()}`
                      : "분할 대기"}
                    {session.chunks_total > 0 && session.unplanned > 0 && (
                      <span className="block text-muted-foreground">
                        분할 대기 {session.unplanned}건
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={selected === session.id}
                      aria-label={`${session.name} 작업 ${selected === session.id ? "접기" : "펼치기"}`}
                      onClick={() => toggle(session.id)}
                    >
                      <ChevronDown
                        className={selected === session.id ? "rotate-180" : ""}
                      />
                      작업
                    </Button>
                  </TableCell>
                </TableRow>
                {selected === session.id && (
                  <TableRow>
                    <TableCell colSpan={7} className="bg-muted/20 p-4">
                      <JobDetails
                        key={session.id}
                        {...props}
                        sourceId={session.id}
                        onRetry={() => {
                          reload();
                          props.onRetry();
                        }}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
      <Pagination
        data={data.pagination}
        pageKey="sessionsPage"
        label="Curation 세션"
      />
    </>
  );
}
function JobDetails({
  workspaceId,
  sourceId,
  schedule,
  reasons,
  statuses,
  onRetry,
}: Props & { sourceId: string }) {
  const query = useSearchParams(),
    base = `/api/workspaces/${workspaceId}`;
  const { data, error, reload } = useApi(
    `${base}/refinement-sessions/${sourceId}/jobs?detailPage=${query.get("detailPage") ?? "1"}&pageSize=${query.get("pageSize") ?? "25"}`,
    15000,
  );
  const [failure, setFailure] = useState<unknown>();
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>원문</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>청크 반영</TableHead>
              <TableHead>시도</TableHead>
              <TableHead>다음 시도 / 최근 변경</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((job: any) => (
              <TableRow key={job.id}>
                <TableCell className="max-w-xs whitespace-normal break-words">
                  <Link
                    className="underline"
                    href={`/workspaces/${workspaceId}/sources/${job.source_id}`}
                  >
                    {job.name}
                  </Link>
                  {job.error_code && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {reasons[job.error_code] ?? job.error_code}
                    </p>
                  )}
                  {job.result?.items?.map((a: any) => (
                    <Link
                      key={a.id}
                      className="block mt-2 text-xs underline"
                      href={`/workspaces/${workspaceId}/knowledge/${a.id}?revision=${a.revision}`}
                    >
                      반영한 지식 · Version {a.revision}
                    </Link>
                  ))}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      job.status === "failed" ? "destructive" : "secondary"
                    }
                  >
                    {job.status === "failed"
                      ? "확인 필요"
                      : job.status === "pending" && job.error_code
                        ? "재시도 대기"
                        : statuses[job.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {job.chunk_count ? (
                    <div className="min-w-28 space-y-2">
                      <span className="text-xs tabular-nums">
                        {job.chunk_index} / {job.chunk_count}
                      </span>
                      <Progress
                        value={(job.chunk_index / job.chunk_count) * 100}
                        aria-label={`${job.name} 청크 반영률`}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      분할 대기
                    </span>
                  )}
                </TableCell>
                <TableCell>{job.attempts}</TableCell>
                <TableCell className="text-xs">
                  {job.status === "pending" ? (
                    <div className="space-y-1">
                      <p>{waitingReasons[schedule.reason]}</p>
                      {!["paused", "key_missing"].includes(schedule.reason) &&
                        (new Date(job.available_at).getTime() > Date.now() ||
                          schedule.nextAttemptAt) && (
                          <p className="text-muted-foreground">
                            <When
                              value={new Date(
                                Math.max(
                                  new Date(job.available_at).getTime(),
                                  new Date(
                                    schedule.nextAttemptAt ?? 0,
                                  ).getTime(),
                                ),
                              ).toISOString()}
                            />{" "}
                            이후
                          </p>
                        )}
                    </div>
                  ) : (
                    <When value={job.updated_at} />
                  )}
                </TableCell>
                <TableCell>
                  {job.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await api(
                            base + "/refinements/" + job.id + "/retry",
                            { method: "POST", body: "{}" },
                          );
                          reload();
                          onRetry();
                        } catch (e) {
                          setFailure(e);
                        }
                      }}
                    >
                      재시도
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        data={data.pagination}
        pageKey="detailPage"
        label="세션 정제 작업"
      />
      {!!failure && <Failure error={failure} />}
    </>
  );
}
