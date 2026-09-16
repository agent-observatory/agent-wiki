"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Minus, X, Circle, Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./status-badge";
import { Empty, Failure, Loading, Section, When } from "./common";
import { reasons } from "./refinement-progress";
import { api, errorText } from "@/lib/api";
// Per-topic view of the latest Consolidation Job (docs/l2-l3-memory.md#job과-step).
// Reads GET /consolidations, which returns Step statuses and counts only; the
// topic's own Knowledge page shows the resulting relations.
export type ConsolidationJob = {
  id: string;
  topic_key: string;
  page_id: string | null;
  page_title: string | null;
  status: "pending" | "running" | "completed" | "failed";
  trigger: "cycle" | "deferred" | "manual";
  attempt: number;
  rerun_requested: boolean;
  current_step: string | null;
  error_code: string | null;
  available_at: string;
  created_at: string;
  updated_at: string;
  steps: Record<
    string,
    {
      status: "pending" | "done" | "failed" | "skipped";
      attempts: number;
      error_code: string | null;
      retry_at: string | null;
    }
  >;
  summary: {
    proposed: number | null;
    leftUnresolved: number | null;
    passed: number | null;
    rejected: number | null;
    published: number | null;
    inboxResolved: number | null;
  };
};
const STEP_NAMES = ["gather", "model", "validate", "publish"] as const;
const jobStatuses: Record<ConsolidationJob["status"], string> = {
  pending: "대기",
  running: "진행 중",
  completed: "완료",
  failed: "확인 필요",
};
const triggers: Record<ConsolidationJob["trigger"], string> = {
  cycle: "자동 · 처리 범위 완료",
  deferred: "자동 · 대기함 관계",
  manual: "수동",
};
export function summarizeConsolidations(items: ConsolidationJob[]) {
  const open = items.filter((j) =>
    ["pending", "running"].includes(j.status),
  ).length;
  const attention = items.filter((j) => j.status === "failed").length;
  const lastCompletedAt = items
    .filter((j) => j.status === "completed")
    .map((j) => j.updated_at)
    .sort()
    .at(-1);
  return { open, attention, lastCompletedAt: lastCompletedAt ?? null };
}
function StepTrail({ job }: { job: ConsolidationJob }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
      {STEP_NAMES.map((name) => {
        const step = job.steps[name] ?? { status: "pending", attempts: 0 };
        const running = job.status === "running" && job.current_step === name;
        const Icon =
          step.status === "done"
            ? Check
            : step.status === "failed"
              ? X
              : step.status === "skipped"
                ? Minus
                : Circle;
        const tone =
          step.status === "done"
            ? "text-foreground"
            : step.status === "failed"
              ? "text-destructive"
              : running
                ? "text-blue-700 dark:text-blue-400"
                : "text-muted-foreground";
        return (
          <span
            key={name}
            className={`inline-flex items-center gap-1 ${tone}`}
            title={
              step.status === "skipped"
                ? "생략 · 통합할 것이 없음"
                : step.attempts > 1
                  ? `시도 ${step.attempts}회`
                  : undefined
            }
          >
            <Icon className="size-3" aria-hidden />
            {name}
            {step.status === "skipped" && (
              <span className="sr-only"> 생략</span>
            )}
          </span>
        );
      })}
    </span>
  );
}
function resultText(job: ConsolidationJob) {
  const s = job.summary;
  if (job.status === "failed")
    return job.error_code
      ? (reasons[job.error_code] ?? job.error_code)
      : "실패";
  if (job.steps.model?.status === "skipped") return "통합할 묶음 없음";
  const parts: string[] = [];
  if (s.published != null) parts.push(`반영 ${s.published}`);
  else if (s.passed != null) parts.push(`통과 ${s.passed}`);
  if (s.rejected != null && s.rejected > 0)
    parts.push(`규칙 거절 ${s.rejected}`);
  if (s.leftUnresolved != null && s.leftUnresolved > 0)
    parts.push(`보류 ${s.leftUnresolved}`);
  if (s.inboxResolved != null && s.inboxResolved > 0)
    parts.push(`대기함 해소 ${s.inboxResolved}`);
  if (parts.length) return parts.join(" · ");
  if (s.proposed != null) return `제안 ${s.proposed}`;
  return "—";
}
export function ConsolidationJobs({
  items,
  error,
  root,
  base,
  onScheduled,
}: {
  items?: ConsolidationJob[];
  error?: unknown;
  root: string;
  base: string;
  onScheduled?: () => void;
}) {
  const summary = items ? summarizeConsolidations(items) : null;
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<unknown>();
  const [runResult, setRunResult] = useState<string>();
  const busy = !!items && (summary?.open ?? 0) > 0;
  async function runNow() {
    if (running || busy) return;
    setRunning(true);
    setRunError(undefined);
    setRunResult(undefined);
    try {
      const result = await api<{ scheduled: string[] }>(
        base + "/consolidations",
        { method: "POST", body: JSON.stringify({ all: true }) },
      );
      setRunResult(`${result.scheduled.length}개 주제 예약`);
    } catch (e) {
      setRunError(e);
    } finally {
      setRunning(false);
      onScheduled?.();
    }
  }
  return (
    <Section
      id="curation-consolidations"
      title={
        items
          ? `통합 Job · 주제 ${items.length.toLocaleString()}개${
              summary!.open ? ` · 열림 ${summary!.open}개` : ""
            }`
          : "통합 Job"
      }
      action={
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={running || busy || !items}
            onClick={runNow}
          >
            {running ? <RefreshCw className="animate-spin" /> : <Play />}
            지금 통합 실행
          </Button>
          {runResult && (
            <p className="text-xs text-muted-foreground">{runResult}</p>
          )}
          {runError != null && (
            <p role="alert" className="text-xs text-destructive">
              {errorText(runError)}
            </p>
          )}
        </div>
      }
    >
      {error ? (
        <Failure error={error} />
      ) : !items ? (
        <Loading />
      ) : !items.length ? (
        <Empty>
          아직 실행한 통합 Job이 없습니다. 세션의 처리 범위가 끝나면 닿은
          주제마다 자동으로 만들어집니다.
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>주제</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>결과</TableHead>
                <TableHead>트리거</TableHead>
                <TableHead className="text-right">갱신</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((job) => (
                <TableRow key={job.id} data-job-status={job.status}>
                  <TableCell className="min-w-48 max-w-xs whitespace-normal break-words">
                    {job.page_id ? (
                      <Link
                        href={`${root}/${job.page_id}?page=true`}
                        className="underline-offset-4 hover:underline"
                      >
                        {job.page_title ?? job.topic_key}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        {job.topic_key}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={job.status}>
                        {jobStatuses[job.status]}
                      </StatusBadge>
                      {job.rerun_requested && (
                        <Badge variant="outline">재실행 예약</Badge>
                      )}
                      {job.attempt > 0 && (
                        <Badge variant="outline">재시작 {job.attempt}</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StepTrail job={job} />
                  </TableCell>
                  <TableCell
                    className={`whitespace-normal ${job.status === "failed" ? "text-destructive" : ""}`}
                  >
                    {resultText(job)}
                    {job.status === "failed" &&
                      job.error_code &&
                      reasons[job.error_code] && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({job.error_code})
                        </span>
                      )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {triggers[job.trigger] ?? job.trigger}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    <When value={job.updated_at} compact />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}
