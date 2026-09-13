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
  active_chunks_done: number;
  active_chunks_total: number;
  waiting_sources: number;
  active_batches: number;
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
        전체 {data.total.toLocaleString()}개 세션
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
              <TableHead>상태</TableHead>
              <TableHead className="text-right">처리한 원문 조각</TableHead>
              <TableHead className="text-right">이번 묶음 · 청크</TableHead>
              <TableHead className="text-right">
                다음 처리 대기 · 조각
              </TableHead>
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
                        session.running
                          ? "running"
                          : session.failed
                            ? "failed"
                            : session.retrying
                              ? "interrupted"
                              : session.pending
                                ? "pending"
                                : "completed"
                      }
                    >
                      {session.running
                        ? "진행 중"
                        : session.failed
                          ? "확인 필요"
                          : session.retrying
                            ? "재시도 대기"
                            : session.pending
                              ? "대기"
                              : "완료"}
                    </StatusBadge>
                    {session.failed > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => retry(session.id)}
                        aria-label={`${session.name} 실패 작업 재시도`}
                      >
                        {busy === session.id ? "처리 중" : "재시도"}
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {session.completed.toLocaleString()} /{" "}
                  {session.total.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {session.active_chunks_total > 0
                    ? `${session.active_chunks_done.toLocaleString()} / ${session.active_chunks_total.toLocaleString()}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {session.waiting_sources.toLocaleString()}
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
