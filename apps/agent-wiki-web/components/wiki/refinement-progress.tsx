"use client";
import { Database, ListChecks, FileCheck2, Clock3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { When } from "./common";

export const waitingReasons: Record<string, string> = {
  paused: "자동 정제 일시 중지",
  pausing: "중지 요청됨 · 현재 작업 마무리 중",
  key_missing: "API 키 확인 필요",
  daily_limit: "설정한 일일 한도 소진 · 다음 날 재개",
  provider_cooldown: "API 호출 간격·제공자 제한 대기",
  retry_wait: "일시 오류 · 자동 재시도 대기",
  ready: "다음 자료 처리 대기",
  running: "정제 진행 중",
  idle: "대기 작업 없음",
  needs_attention: "확인이 필요한 자료가 있습니다",
};

export type RefinementProgressData = {
  summary: {
    total: number;
    completed: number;
    pending: number;
    running: number;
    failed: number;
    unplanned: number;
    chunks_done: number;
    chunks_total: number;
  };
  storage: {
    sources: number;
    uploads_completed: number;
    uploads_pending: number;
  };
  schedule: { reason: string; nextAttemptAt: string | null };
  lastProgressAt: string | null;
  checkedAt: string;
};

export function RefinementProgress({ data }: { data: RefinementProgressData }) {
  const { summary: s, storage, schedule } = data;
  const percent = s.chunks_total
    ? Math.floor((s.chunks_done / s.chunks_total) * 100)
    : 0;
  return (
    <section
      aria-label="원문에서 지식까지의 처리 현황"
      className="mb-6 space-y-4"
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Database className="size-4" />
              L1 · 원문 보관
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {storage.sources.toLocaleString()}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                자료
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              검증 완료 업로드 {storage.uploads_completed.toLocaleString()}건 ·
              전송·검증 중 {storage.uploads_pending.toLocaleString()}건
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ListChecks className="size-4" />
              L2 · 청크 정제·반영
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {s.chunks_done.toLocaleString()}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                / {s.chunks_total.toLocaleString()} 청크
              </span>
            </p>
            {s.chunks_total > 0 && (
              <Progress
                value={percent}
                aria-label="분할된 청크 반영률"
                aria-valuetext={`${s.chunks_done} / ${s.chunks_total} 청크 반영`}
              />
            )}
            <p className="text-xs text-muted-foreground">
              {s.chunks_total > 0 ? `분할된 청크 기준 ${percent}% · ` : ""}분할
              대기 {s.unplanned.toLocaleString()}자료
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileCheck2 className="size-4" />
              L3 · 처리 완료
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {s.completed.toLocaleString()}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                / {s.total.toLocaleString()} 자료
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              모든 청크 검증·반영 완료 · 새 지식이 없는 자료 포함
            </p>
          </CardContent>
        </Card>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg bg-muted/40 px-4 py-3 text-sm"
        role="status"
      >
        <span className="flex items-center gap-2 font-medium">
          <Clock3 className="size-4 shrink-0" />
          {waitingReasons[schedule.reason]}
        </span>
        <span className="text-muted-foreground">
          대기 {s.pending.toLocaleString()} · 진행 {s.running.toLocaleString()}
        </span>
        {s.failed > 0 && (
          <Badge variant="destructive">
            확인 필요 {s.failed.toLocaleString()}
          </Badge>
        )}
        {schedule.nextAttemptAt && (
          <span className="text-muted-foreground">
            다음 시도 가능 <When value={schedule.nextAttemptAt} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {data.lastProgressAt ? (
            <>
              마지막 청크 반영 <When value={data.lastProgressAt} />
            </>
          ) : (
            "아직 반영한 청크가 없습니다."
          )}
        </span>
        <span>
          15초마다 갱신 · <When value={data.checkedAt} />
        </span>
      </div>
    </section>
  );
}
