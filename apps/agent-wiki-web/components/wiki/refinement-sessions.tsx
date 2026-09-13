"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { useApi, api, errorText } from "@/lib/api";
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
      await api<{ retried: number }>(
        `/api/workspaces/${props.workspaceId}/refinement-sessions/${id}/retry`,
        { method: "POST", body: "{}" },
      );
      setMessage(
        "이 세션을 재시도 대기에 넣었습니다. 자동 정제가 중지되어 있으면 재개 후 실행합니다.",
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
                      {
                        {
                          waiting: "정제 대기",
                          curating: "정제 중",
                          applying: "지식 반영 중",
                          retrying: "재시도 대기",
                          attention: "확인 필요",
                          current: "최신 수집분 반영 완료",
                        }[session.state]
                      }
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
