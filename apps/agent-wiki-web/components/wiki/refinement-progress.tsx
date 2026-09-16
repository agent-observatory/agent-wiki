"use client";
import { layerLabel } from "@/lib/layers";
import { Database, ListChecks, FileCheck2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { When } from "./common";

// Shared vocabulary for every L2 status surface (session list, call history,
// repeated errors, consolidation jobs), kept in one place so the same code
// never reads differently on two rows.
export const statuses: Record<string, string> = {
  uploading: "전송 중",
  queued: "검증 대기",
  verifying: "검증 중",
  expired: "만료",
  pending: "대기",
  running: "진행 중",
  completed: "완료",
  failed: "실패",
  interrupted: "중단",
};
export const reasons: Record<string, string> = {
  AI_LINE_TOO_LARGE:
    "단일 근거 줄이 너무 깁니다. 새 수집 경로로 재수집하거나 입력 예산을 늘려 주세요.",
  AI_INPUT_BUDGET_TOO_SMALL: "지침과 근거를 담기에 입력 예산이 작습니다.",
  AI_INPUT_LIMIT: "원문이 입력 한도를 초과했습니다.",
  AI_OUTPUT_LIMIT: "모델 출력 한도에 도달했습니다.",
  AI_INVALID_JSON: "모델이 올바른 JSON을 반환하지 않았습니다.",
  AI_INVALID_OUTPUT: "정제 결과 형식이 맞지 않습니다.",
  SOURCE_AUTH_FAILED: "원문 저장소 인증을 확인하세요.",
  AI_TOPIC_REQUIRED: "정제 결과에 Wiki 주제가 없어 재시도합니다.",
  AI_EVIDENCE_REFERENCE_INVALID: "원문 기록 참조가 올바르지 않아 재시도합니다.",
  AI_EVIDENCE_REQUIRED: "정확한 원문 근거가 부족합니다.",
  EVIDENCE_MISMATCH: "인용이 원문과 다릅니다.",
  AI_HTTP_401: "API 키를 확인하세요.",
  AI_HTTP_403: "모델 접근 권한을 확인하세요.",
  AI_HTTP_529: "제공자 일시 오류로 재시도 대기 중입니다.",
  AI_HTTP_429: "제공자 호출 한도로 재시도 대기 중입니다.",
  AI_HTTP_202: "모델 처리 대기 시간이 초과됐습니다.",
  AI_CONNECTION_FAILED: "모델 연결이 끊기거나 시간이 초과됐습니다.",
  WORKER_STOPPED: "배포 또는 종료로 중단됐습니다.",
  LEASE_EXPIRED: "중단된 작업을 복구했습니다.",
  AI_TIMEOUT: "모델 응답 시간이 초과됐습니다.",
  REVISION_CONFLICT: "기존 지식의 Version이 변경됐습니다.",
  // Consolidation Job outcomes (docs/l2-l3-memory.md#job과-step).
  CLAIM_TARGET_VERSION_CHANGED:
    "대상 주장의 Version이 바뀌어 gather부터 다시 시작했습니다.",
  CLAIM_TARGET_ALREADY_RETIRED: "대상 주장이 이미 대체·철회됐습니다.",
  CONSOLIDATION_STEP_FAILED: "통합 Step이 예기치 않게 실패했습니다.",
  DECISION_EVIDENCE_NOT_USER: "결정 주장에 사용자 발화 근거가 없어 재시도합니다.",
  SUPERSEDES_BACKWARD_IN_TIME: "대체 근거 시점이 대상보다 앞서 재시도합니다.",
};
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
  sessions: {
    total: number;
    current: number;
    waiting: number;
    attention: number;
    records: number;
    lastCollectedAt: string | null;
    lastReflectedAt: string | null;
  };
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
    source_groups: number;
    articles: number;
    uploads_completed: number;
    uploads_pending: number;
  };
  schedule: { reason: string; nextAttemptAt: string | null };
  lastProgressAt: string | null;
  checkedAt: string;
};

export function RefinementProgress({ data }: { data: RefinementProgressData }) {
  const { sessions, storage, summary } = data;
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
              {layerLabel("L1")}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {storage.source_groups.toLocaleString()}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                세션
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {sessions.records.toLocaleString()}개 기록
              {sessions.lastCollectedAt && (
                <>
                  {" "}
                  · 마지막 수집 <When value={sessions.lastCollectedAt} />
                </>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ListChecks className="size-4" />
              {layerLabel("L2")}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {summary.chunks_done.toLocaleString()}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                / {summary.chunks_total.toLocaleString()}개 청크
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              처리 대기 세션 {sessions.waiting.toLocaleString()}개 · 아래 세션
              목록 참고
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileCheck2 className="size-4" />
              {layerLabel("L3")}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {storage.articles.toLocaleString()}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                지식
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {sessions.lastReflectedAt ? (
                <>
                  마지막 반영 <When value={sessions.lastReflectedAt} />
                </>
              ) : (
                "아직 반영한 수집분이 없습니다."
              )}
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          15초마다 갱신 · <When value={data.checkedAt} />
        </span>
      </div>
    </section>
  );
}
