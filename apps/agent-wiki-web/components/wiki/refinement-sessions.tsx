"use client";
import Link from "next/link";

import { useRouter, useSearchParams } from "next/navigation";
import { useApi, api } from "@/lib/api";
import { When } from "./common";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "./status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "./pagination";
import { Empty, Failure, Loading } from "./common";

type Props = { workspaceId: string };
type Session = {
  id: string;
  name: string;
  state:
    "waiting" | "curating" | "applying" | "retrying" | "attention" | "current";
  percent: number | null;
  failed: number;
  new_records: number;
  waiting_inputs: boolean;
  cycle_id: string | null;
  cycle_records: number;
  has_previous: boolean;
  reflected_at: string | null;
};
type Page = { page: number; pageSize: number; hasNext: boolean };
// Simplified 3-bucket view of the finer session states above, shown as an
// enum-style label so the filter and the per-row badge stay in sync.
const sessionStatuses = ["PENDING", "IN_PROGRESS", "DONE"] as const;
type SessionStatus = (typeof sessionStatuses)[number];
function sessionStatus(state: Session["state"]): SessionStatus {
  return state === "waiting"
    ? "PENDING"
    : state === "current"
      ? "DONE"
      : "IN_PROGRESS";
}
export function RefinementSessions(props: Props) {
  const query = useSearchParams();
  const router = useRouter();
  const status = query.get("sessionsStatus");
  const { data, error, reload } = useApi<{
    items: Session[];
    total: number;
    pagination: Page;
  }>(
    `/api/workspaces/${props.workspaceId}/refinement-sessions?${query}`,
    15000,
  );
  function setStatus(value: SessionStatus | null) {
    const next = new URLSearchParams(query);
    next.delete("sessionsPage");
    if (value) next.set("sessionsStatus", value);
    else next.delete("sessionsStatus");
    router.push(`?${next}`, { scroll: false });
  }
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          전체 {data.total.toLocaleString()}개 세션
        </p>
        <div className="ml-auto flex gap-1 text-xs">
          {[null, ...sessionStatuses].map((value) => (
            <button
              key={value ?? "all"}
              type="button"
              onClick={() => setStatus(value)}
              className={
                "rounded-md border px-2 py-1 " +
                ((value ?? null) === status
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {value ?? "전체"}
            </button>
          ))}
        </div>
      </div>
      {!data.items.length ? (
        <Empty>수집한 원문이 들어오면 정제 작업이 표시됩니다.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>세션</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>이번 처리</TableHead>
              <TableHead className="text-right">새 기록</TableHead>
              <TableHead className="text-right">마지막 반영</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((session) => (
              <TableRow key={session.id}>
                <TableCell className="min-w-48 max-w-xs whitespace-normal break-words">
                  <Link
                    className="underline"
                    href={`/workspaces/${props.workspaceId}/sources/${session.id}`}
                  >
                    {session.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={
                        session.state === "attention"
                          ? "failed"
                          : session.state === "retrying"
                            ? "interrupted"
                            : session.state === "current"
                              ? "completed"
                              : ["curating", "applying"].includes(session.state)
                                ? "running"
                                : "pending"
                      }
                    >
                      {sessionStatus(session.state)}
                    </StatusBadge>
                  </div>
                </TableCell>
                <TableCell className="min-w-40">
                  {session.percent !== null && session.state !== "current" ? (
                    <div
                      className="flex items-center gap-3"
                      title={`고정된 수집 범위 · ${session.cycle_records.toLocaleString()}개 기록`}
                    >
                      <Progress
                        value={session.percent}
                        className="w-24"
                        aria-label={`${session.name} 이번 처리 진행률`}
                      />
                      <span className="tabular-nums">{session.percent}%</span>
                    </div>
                  ) : session.has_previous && session.state !== "current" ? (
                    <span className="text-xs text-muted-foreground">
                      이전 수집분 반영 완료
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {session.new_records > 0
                    ? `${session.new_records.toLocaleString()}개 대기`
                    : session.waiting_inputs
                      ? "새 자료 대기"
                      : "—"}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                  {session.reflected_at ? (
                    <When value={session.reflected_at} />
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
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
