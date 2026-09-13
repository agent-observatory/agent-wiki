"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { useApi, api, errorText } from "@/lib/api";
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
  const query = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const { data, error, reload } = useApi<{
    items: Session[];
    total: number;
    pagination: Page;
  }>(
    `/api/workspaces/${props.workspaceId}/refinement-sessions?${query}`,
    15000,
  );
  async function retry(id: string) {
    setBusy(id);
    setMessage("");
    try {
      const result = await api<{ retried: number }>(
        `/api/workspaces/${props.workspaceId}/refinement-sessions/${id}/retry`,
        { method: "POST", body: "{}" },
      );
      setMessage(
        `${result.retried}개 작업을 재시도 대기에 넣었습니다. 자동 정제가 중지되어 있으면 재개 후 실행합니다.`,
      );
      reload();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <p className="mb-4 text-xs text-muted-foreground">
        전체 {data.total.toLocaleString()}개 세션 · 상태별 수는 정제 작업 기준
      </p>
      {message && (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {message}
        </p>
      )}
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
                <TableCell className="text-right tabular-nums">
                  {session.pending.toLocaleString()}
                  {session.retrying > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      재시도 {session.retrying}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {session.running > 0 ? (
                    <StatusBadge
                      status="running"
                      aria-label={`진행 중 ${session.running}개`}
                    >
                      {session.running.toLocaleString()}
                    </StatusBadge>
                  ) : (
                    "0"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {session.failed > 0 ? (
                    <div className="flex items-center justify-end gap-2">
                      <StatusBadge
                        status="failed"
                        aria-label={`실패 ${session.failed}개`}
                      >
                        {session.failed}
                      </StatusBadge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => retry(session.id)}
                        aria-label={`${session.name} 실패 작업 재시도`}
                      >
                        {busy === session.id ? "처리 중" : "재시도"}
                      </Button>
                    </div>
                  ) : (
                    "0"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {session.completed > 0 ? (
                    <StatusBadge
                      status="completed"
                      aria-label={`완료 ${session.completed}개`}
                    >
                      {session.completed.toLocaleString()}
                    </StatusBadge>
                  ) : (
                    "0"
                  )}
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
