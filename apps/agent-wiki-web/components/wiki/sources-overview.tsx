"use client";
import { SECTION_NAMES, LAYER_NAMES } from "@/lib/layers";
import { formatWhen } from "@/lib/time";
import { StatusBadge } from "./status-badge";
import { Pagination } from "./pagination";

import Link from "next/link";
import { useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { RefreshCw, Play, Pause, Activity, FileText } from "lucide-react";
import { SourceList } from "./sources";
import {
  RefinementProgress,
  waitingReasons,
  statuses,
  reasons,
} from "./refinement-progress";
import { RefinementSessions } from "./refinement-sessions";
import {
  ConsolidationJobs,
  summarizeConsolidations,
  type ConsolidationJob,
} from "./consolidation-jobs";
import { api, errorText, useApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Heading, Loading, Failure, Empty, When, Section } from "./common";
export function SourcesOverview() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return <SourcesContent key={workspaceId} />;
}
function SourcesContent() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const base = "/api/workspaces/" + workspaceId;
  const query = useSearchParams(),
    router = useRouter();
  const tab = ["raw", "collectors"].includes(query.get("tab") ?? "")
    ? query.get("tab")!
    : "curation";
  function setTab(value: string) {
    const next = new URLSearchParams({ tab: value });
    router.push(`?${next}`, { scroll: false });
  }
  const jobs = useApi(base + "/refinements?" + query, 15000);
  // Consolidation is the L2 stage after extraction (docs/l2-l3-memory.md
  // #통합--consolidation); its model calls already count in "오늘 모델 호출"
  // and 호출 이력, so its Job state belongs on this tab next to them.
  const consolidations = useApi<{ items: ConsolidationJob[] }>(
    base + "/consolidations",
    15000,
  );
  const consolidationSummary = consolidations.data
    ? summarizeConsolidations(consolidations.data.items)
    : null;
  const serverControl = jobs.data?.progress.control;
  const [savedControl, setSavedControl] = useState<{
    enabled: boolean;
    version: number;
  }>();
  const liveControl =
    savedControl &&
    serverControl &&
    savedControl.version > serverControl.version
      ? { ...serverControl, ...savedControl }
      : serverControl;
  const [savingControl, setSavingControl] = useState(false);
  const [controlError, setControlError] = useState<unknown>();
  async function toggleCuration() {
    if (!liveControl || savingControl) return;
    setSavingControl(true);
    setControlError(undefined);
    try {
      const result = await api(base + "/ai-settings/enabled", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: !liveControl.enabled,
          version: liveControl.version,
        }),
      });
      setSavedControl({ enabled: result.enabled, version: result.version });
    } catch (error) {
      setControlError(error);
    } finally {
      jobs.reload();
      setSavingControl(false);
    }
  }
  const [refreshVersion, refreshSources] = useState(0);
  return (
    <>
      <Heading
        title={SECTION_NAMES.sources}
        description="원문 보관과 수집·정제 현황을 함께 확인합니다."
        action={
          <Button
            variant="outline"
            onClick={() => {
              jobs.reload();
              consolidations.reload();
              refreshSources((value) => value + 1);
            }}
          >
            <RefreshCw />
            새로고침
          </Button>
        }
      />
      {jobs.error ? (
        <Failure error={jobs.error} />
      ) : jobs.data ? (
        <RefinementProgress data={jobs.data.progress} />
      ) : (
        <Loading />
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="curation">
            <Activity className="size-4 mr-2" />
            {LAYER_NAMES.L2}
          </TabsTrigger>
          <TabsTrigger value="collectors">수집 상태</TabsTrigger>
          <TabsTrigger value="raw">
            <FileText className="size-4 mr-2" />
            {LAYER_NAMES.L1}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="raw" className="pt-6">
          <SourceList key={refreshVersion} />
        </TabsContent>
        <TabsContent value="curation" className="pt-6">
          {jobs.data && (
            <>
              <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <section className="rounded-lg border p-5">
                  <p className="text-sm text-muted-foreground">자동 정제</p>
                  <div className="flex gap-2 items-center justify-between mt-3 font-semibold">
                    <span className="inline-flex items-center gap-2">
                      {liveControl.enabled ? (
                        <Play className="size-4 text-emerald-700 dark:text-emerald-400" />
                      ) : (
                        <Pause className="size-4 text-amber-800 dark:text-amber-400" />
                      )}
                      {liveControl.enabled
                        ? "활성"
                        : jobs.data.progress.summary.running
                          ? "마무리 중"
                          : "일시 중지"}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={savingControl}
                      onClick={toggleCuration}
                    >
                      {savingControl ? (
                        <RefreshCw className="animate-spin" />
                      ) : liveControl.enabled ? (
                        <Pause />
                      ) : (
                        <Play />
                      )}
                      {savingControl
                        ? "저장 중"
                        : liveControl.enabled
                          ? "중지"
                          : "재개"}
                    </Button>
                  </div>
                  {controlError != null && (
                    <p role="alert" className="mt-2 text-xs text-destructive">
                      {errorText(controlError)}
                    </p>
                  )}
                  <div
                    role="status"
                    className="mt-3 space-y-2 text-xs text-muted-foreground"
                  >
                    <p>
                      미반영 세션{" "}
                      {jobs.data.progress.sessions.waiting.toLocaleString()}개
                      {jobs.data.progress.sessions.attention > 0 && (
                        <span className="ml-2">
                          <StatusBadge status="failed">
                            확인 필요 {jobs.data.progress.sessions.attention}개
                          </StatusBadge>
                        </span>
                      )}
                    </p>
                    {!liveControl.enabled &&
                      jobs.data.progress.control.stoppedReason ===
                        "AI_FREE_QUOTA_EXHAUSTED" && (
                        <p className="text-destructive">
                          무료 할당량 소진으로 중지됨
                        </p>
                      )}
                    {liveControl.enabled && (
                      <p>
                        {waitingReasons[jobs.data.progress.schedule.reason]}
                      </p>
                    )}
                    {jobs.data.progress.control.fallbackActive && (
                      <p className="text-amber-700 dark:text-amber-400">
                        1번 모델 한도 소진 · 2번 모델{" "}
                        {jobs.data.progress.control.activeModel} 사용 중
                      </p>
                    )}
                    {liveControl.enabled &&
                      jobs.data.progress.schedule.nextAttemptAt && (
                        <p>
                          다음 시도{" "}
                          <When
                            value={jobs.data.progress.schedule.nextAttemptAt}
                          />
                        </p>
                      )}
                    <p>중지해도 원문 수집은 계속됩니다.</p>
                  </div>
                </section>
                <section className="rounded-lg border p-5">
                  <p className="text-sm text-muted-foreground">
                    통합 · Consolidation
                  </p>
                  {consolidations.error ? (
                    <p role="alert" className="mt-3 text-xs text-destructive">
                      {errorText(consolidations.error)}
                    </p>
                  ) : !consolidationSummary ? (
                    <Skeleton className="mt-3 h-7 w-28" aria-label="불러오는 중" />
                  ) : (
                    <>
                      <p className="mt-3 text-xl font-semibold">
                        {consolidationSummary.open}개
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}
                          열린 Job
                        </span>
                        {consolidationSummary.attention > 0 && (
                          <span className="ml-2 align-middle">
                            <StatusBadge status="failed">
                              확인 필요 {consolidationSummary.attention}개
                            </StatusBadge>
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {consolidations.data!.items.length === 0
                          ? "세션의 처리 범위가 끝나면 주제마다 Job을 만듭니다."
                          : consolidationSummary.lastCompletedAt
                            ? (
                              <>
                                주제 {consolidations.data!.items.length}개 ·
                                마지막 완료{" "}
                                <When
                                  value={consolidationSummary.lastCompletedAt}
                                  compact
                                />
                              </>
                            )
                            : `주제 ${consolidations.data!.items.length}개 · 아직 완료한 Job 없음`}
                      </p>
                    </>
                  )}
                </section>
                <section className="rounded-lg border p-5">
                  <p className="text-sm text-muted-foreground">
                    오늘 모델 호출
                  </p>
                  <p className="mt-3 text-xl font-semibold">
                    {jobs.data.today.calls}회
                    {jobs.data.progress.control.dailyCalls !== null && (
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        / {jobs.data.progress.control.dailyCalls}회
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {jobs.data.progress.control.dailyCalls === null
                      ? `일일 제한 없음 · 최대 ${jobs.data.progress.control.requestsPerMinute} RPM · 동시 실행 ${jobs.data.progress.control.concurrency}개`
                      : "설정한 한도 도달 시 UTC 자정까지 대기"}
                  </p>
                </section>
                <section className="rounded-lg border p-5">
                  <p className="text-sm text-muted-foreground">
                    오늘 보고된 토큰
                  </p>
                  <p className="mt-3 text-xl font-semibold">
                    {Number(jobs.data.today.tokens).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    응답 없는 호출의 사용량은 포함되지 않습니다.
                  </p>
                </section>
              </div>

              <Section
                id="curation-sessions"
                title={`정제 세션 · ${jobs.data.progress.sessions.total.toLocaleString()}개`}
              >
                <RefinementSessions workspaceId={workspaceId} />
              </Section>
              <ConsolidationJobs
                items={consolidations.data?.items}
                error={consolidations.error}
                root={`/workspaces/${workspaceId}/knowledge`}
                base={base}
                onScheduled={consolidations.reload}
              />
              <RefinementHealth data={jobs.data.health} />
              {!!jobs.data.runs.length && (
                <Section id="curation-call-history" title="호출 이력">
                  <div className="divide-y border-y">
                    {jobs.data.runs.map((r: any) => (
                      <CallHistoryRow key={r.id} run={r} />
                    ))}
                  </div>
                  <Pagination
                    data={jobs.data.pagination.runs}
                    pageKey="runsPage"
                    label="호출 이력"
                  />
                </Section>
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value="collectors" className="pt-6">
          {jobs.data && (
            <>
              {!!jobs.data.uploads?.length && (
                <section className="mb-8">
                  <h2 className="font-semibold mb-4">최근 원본 업로드</h2>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>세션</TableHead>
                          <TableHead>원본 보관</TableHead>
                          <TableHead>압축 크기</TableHead>
                          <TableHead>신규 / 중복 기록</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jobs.data.uploads.map((u: any) => (
                          <TableRow key={u.id}>
                            <TableCell className="max-w-sm break-words">
                              {u.name}
                              {u.error_code && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {u.error_code}
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={u.status}>
                                {statuses[u.status] ?? u.status}
                              </StatusBadge>
                            </TableCell>
                            <TableCell>
                              {(Number(u.compressed_bytes) / 1048576).toFixed(
                                2,
                              )}{" "}
                              MB
                            </TableCell>
                            <TableCell>
                              {u.result
                                ? `${u.result.accepted} / ${u.result.duplicate}`
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
              <Pagination
                data={jobs.data.pagination.uploads}
                pageKey="uploadsPage"
                label="업로드"
              />
              {!jobs.data.streams.length ? (
                <Empty>
                  아직 수집한 세션이 없습니다. Agent Wiki Client를 연결해
                  주세요.
                </Empty>
              ) : (
                <div className="divide-y border-y">
                  {jobs.data.streams.map((s: any) => (
                    <div key={s.id} className="py-3 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                        <p className="min-w-0 break-words">
                          {s.name} <Badge variant="outline">{s.client}</Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          최근 수신 <When value={s.updated_at} compact />
                        </p>
                      </div>
                      {s.origins?.map((o: any, i: number) => (
                        <p
                          key={i}
                          className="mt-1 text-xs text-muted-foreground"
                        >
                          {o.machine} · 검증 완료 {o.records}개 기록 ·{" "}
                          {(Number(o.bytes) / 1048576).toFixed(2)} MB 위치
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <Pagination
                data={jobs.data.pagination.streams}
                pageKey="streamsPage"
                label="수집 세션"
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function CallHistoryRow({ run: r }: { run: any }) {
  const diagnostics = r.diagnostics;
  const evidence = diagnostics?.evidenceValidation;
  return (
    <div className="py-3 space-y-1.5" data-call-status={r.status}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <StatusBadge status={r.status}>
          {r.status === "completed" ? "성공" : (statuses[r.status] ?? r.status)}
        </StatusBadge>
        <span className="min-w-0 break-all text-sm text-foreground">
          {r.settings.provider} · {r.settings.model}
        </span>
        <span>{r.prompt_version}</span>
        {diagnostics?.kind === "reprocess" && (
          <Badge variant="secondary">
            재작업 · {diagnostics.stage === "candidate" ? "검토 후보" : "분석"}
          </Badge>
        )}
        {diagnostics?.kind === "consolidation" && (
          <Badge variant="secondary">통합</Badge>
        )}
        <span className="inline-flex flex-wrap gap-x-2 gap-y-1 tabular-nums">
          {diagnostics?.attempt != null && (
            <span>시도 {diagnostics.attempt}</span>
          )}
          {diagnostics?.durationMs != null && (
            <span>{(diagnostics.durationMs / 1000).toFixed(1)}초</span>
          )}
          <span>
            입력 {r.usage?.prompt_tokens?.toLocaleString() ?? "—"} / 출력{" "}
            {r.usage?.completion_tokens?.toLocaleString() ?? "—"}
          </span>
          {r.usage?.prompt_tokens_details?.cached_tokens != null && (
            <span title="입력 토큰에 포함">
              캐시{" "}
              {r.usage.prompt_tokens_details.cached_tokens.toLocaleString()}
            </span>
          )}
          {r.usage?.completion_tokens_details?.reasoning_tokens != null && (
            <span title="출력 토큰에 포함">
              추론{" "}
              {r.usage.completion_tokens_details.reasoning_tokens.toLocaleString()}
            </span>
          )}
          <span
            title={JSON.stringify({
              enable_thinking: r.settings.enable_thinking,
              thinking_budget: r.settings.thinking_budget,
              reasoning_effort: r.settings.reasoning,
              max_completion_tokens: r.settings.max_completion_tokens,
              max_tokens: r.settings.maxTokens,
              maxInputTokens: r.settings.maxInputTokens,
              finish_reason: diagnostics?.finishReason,
            })}
          >
            {r.settings.enable_thinking === false ||
            (r.settings.enable_thinking == null &&
              r.settings.reasoning === "none")
              ? "thinking off"
              : `thinking ${r.settings.thinking_budget ?? r.settings.reasoning ?? "default"}`}
          </span>
          {diagnostics?.httpStatus != null && (
            <span
              title={`HTTP 요청 ${diagnostics.httpRequests ?? "미집계"}회${
                diagnostics.providerError?.code
                  ? ` · 제공자 코드 ${diagnostics.providerError.code}`
                  : ""
              }`}
            >
              HTTP {diagnostics.httpStatus}
            </span>
          )}
          {diagnostics?.httpRequests != null &&
            (diagnostics.httpStatus == null ||
              diagnostics.httpRequests > 1) && (
              <span>HTTP 요청 {diagnostics.httpRequests}회</span>
            )}
        </span>
        {!r.error_code && evidence?.checked > 0 && (
          <span>
            인용 {evidence.matched}/{evidence.checked} 일치
          </span>
        )}
        <span className="ml-auto">
          <When value={r.created_at} compact />
        </span>
      </div>
      {(r.error_code ||
        diagnostics?.retryAt ||
        diagnostics?.skippedReason === "omitted_fields_only") && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {r.error_code && (
            <span className="break-words text-foreground">
              {stages[diagnostics?.stage] ?? "단계 미집계"} ·{" "}
              {reasons[r.error_code] ?? r.error_code}
              {reasons[r.error_code] && (
                <span className="text-muted-foreground"> ({r.error_code})</span>
              )}
            </span>
          )}
          {r.error_code && evidence?.checked > 0 && (
            <span>
              인용 {evidence.matched}/{evidence.checked} 일치
              {evidence.mismatched > 0 && ` · 불일치 ${evidence.mismatched}개`}
            </span>
          )}
          {diagnostics?.retryAt && (
            <span
              title={formatWhen(diagnostics.retryAt)}
            >
              당시 재시도 예약{" "}
              {new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
              }).format(new Date(diagnostics.retryAt))}
              {diagnostics.retryDelaySeconds != null &&
                ` · 대기 ${Math.round(diagnostics.retryDelaySeconds)}초`}
            </span>
          )}
          {diagnostics?.skippedReason === "omitted_fields_only" && (
            <span>모델 호출 생략 · 정제 대상 텍스트 없음</span>
          )}
        </div>
      )}
    </div>
  );
}

const stages: Record<string, string> = {
  prepare: "입력 준비",
  model: "모델 호출",
  validate: "응답 검증",
  publish: "지식 반영",
  completed: "완료",
};
function RefinementHealth({ data }: { data: any }) {
  if (!data) return null;
  if (!data.errors.length) return null;
  return (
    <Section id="curation-repeated-errors" title="반복 오류 · 상위 10개">
      <div className="space-y-2">
        {data.errors.map((e: any) => (
          <div
            key={`${e.provider}/${e.model}/${e.error_code}/${e.stage}`}
            className="flex flex-wrap justify-between gap-2 text-xs border-b pb-2"
          >
            <div className="min-w-0 break-words">
              <span className="font-medium">
                {reasons[e.error_code] ?? e.error_code}
              </span>{" "}
              <StatusBadge status="failed">{e.count}회</StatusBadge>{" "}
              <span className="text-muted-foreground">
                · {stages[e.stage] ?? "단계 미집계"} · {e.provider} / {e.model}
              </span>
            </div>
            <span className="text-muted-foreground">
              최근 <When value={e.last_seen} compact />
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
