"use client";
import { layerLabel, LAYER_NAMES } from "@/lib/layers";
import { StatusBadge } from "./status-badge";
import { Pagination } from "./pagination";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Save, RefreshCw, Play, Pause, Cpu, Activity } from "lucide-react";
import { RefinementProgress, waitingReasons } from "./refinement-progress";
import { RefinementSessions } from "./refinement-sessions";
import { api, useApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Heading, Loading, Failure, Empty, When } from "./common";
type Config = {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  dailyCalls: number | null;
  maxTokens: number;
  maxInputChars: number;
  maxInputTokens: number;
  reasoning: string;
};
const statuses: Record<string, string> = {
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
const reasons: Record<string, string> = {
  AI_LINE_TOO_LARGE:
    "단일 근거 줄이 너무 깁니다. 새 수집 경로로 재수집하거나 입력 예산을 늘려 주세요.",
  AI_INPUT_BUDGET_TOO_SMALL: "지침과 근거를 담기에 입력 예산이 작습니다.",
  AI_INPUT_LIMIT: "원문이 입력 한도를 초과했습니다.",
  AI_OUTPUT_LIMIT: "모델 출력 한도에 도달했습니다.",
  AI_INVALID_JSON: "모델이 올바른 JSON을 반환하지 않았습니다.",
  AI_INVALID_OUTPUT: "정제 결과 형식이 맞지 않습니다.",
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
};
export function Automation() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return <AutomationContent key={workspaceId} />;
}
function AutomationContent() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const base = "/api/workspaces/" + workspaceId;
  const query = useSearchParams(),
    router = useRouter();
  const tab = query.get("tab") ?? "jobs";
  function setTab(value: string) {
    const next = new URLSearchParams(query);
    next.set("tab", value);
    router.push(`?${next}`, { scroll: false });
  }
  const settings = useApi(base + "/ai-settings"),
    jobs = useApi(base + "/refinements?" + query, 15000);
  const [config, setConfig] = useState<Config>(),
    [draftVersion, setDraftVersion] = useState(0),
    [control, setControl] = useState<{ enabled: boolean; version: number }>(),
    [controlBusy, setControlBusy] = useState(false),
    [controlError, setControlError] = useState<unknown>(),
    [apiKey, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings.data) {
      const { hasKey, version, ...value } = settings.data;
      setConfig(value);
      setDraftVersion(version);
    }
  }, [settings.data]);
  const liveControl =
    control && control.version > (jobs.data?.progress.control.version ?? -1)
      ? control
      : jobs.data?.progress.control;
  async function toggleRefinement() {
    if (!liveControl || controlBusy) return;
    setControlBusy(true);
    setControlError(undefined);
    try {
      const result = await api(base + "/ai-settings/enabled", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: !liveControl.enabled,
          version: liveControl.version,
        }),
      });
      setControl(result);
      setDraftVersion((v) => (v === liveControl.version ? result.version : v));
      setConfig((c) => (c ? { ...c, enabled: result.enabled } : c));
      jobs.reload();
    } catch (e) {
      setControlError(e);
      jobs.reload();
    } finally {
      setControlBusy(false);
    }
  }
  const update = (
    name: keyof Config,
    value: string | number | boolean | null,
  ) => {
    if (name === "reasoning" && !value) return;
    setSaved(false);
    setConfig((c) => (c ? { ...c, [name]: value } : c));
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await api(base + "/ai-settings", {
        method: "PUT",
        body: JSON.stringify({
          config: { ...config, enabled: liveControl.enabled },
          version: draftVersion,
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      setKey("");
      setSaved(true);
      settings.reload();
      jobs.reload();
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  if (settings.error || jobs.error)
    return <Failure error={settings.error ?? jobs.error} />;
  if (!config || !jobs.data || !settings.data) return <Loading />;
  return (
    <>
      <Heading
        title={layerLabel("L2")}
        description="원문은 Collector가 보내고, 지식은 원격에서 정제합니다."
        action={
          <Button
            variant="outline"
            onClick={() => {
              jobs.reload();
              settings.reload();
            }}
          >
            <RefreshCw />
            새로고침
          </Button>
        }
      />
      <RefinementProgress data={jobs.data.progress} />
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <section className="rounded-lg border p-5">
          <p className="text-sm text-muted-foreground">자동 정제</p>
          <div className="flex gap-2 items-center justify-between mt-3 font-semibold">
            <span className="inline-flex items-center gap-2">
              {liveControl.enabled ? (
                <Play className="size-4" />
              ) : (
                <Pause className="size-4" />
              )}
              {liveControl.enabled
                ? "활성"
                : jobs.data.progress.summary.running
                  ? "마무리 중"
                  : "일시 중지"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={toggleRefinement}
              disabled={controlBusy || busy}
            >
              {liveControl.enabled ? <Pause /> : <Play />}
              {controlBusy ? "변경 중…" : liveControl.enabled ? "중지" : "재개"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            중지해도 원문 수집은 계속됩니다.
          </p>
          {!!controlError && <Failure error={controlError} />}
        </section>
        <section className="rounded-lg border p-5">
          <p className="text-sm text-muted-foreground">오늘 모델 호출</p>
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
              ? "일일 제한 없음 · 최대 20 RPM · 동시 실행 1개"
              : "설정한 한도 도달 시 UTC 자정까지 대기"}
          </p>
        </section>
        <section className="rounded-lg border p-5">
          <p className="text-sm text-muted-foreground">오늘 보고된 토큰</p>
          <p className="mt-3 text-xl font-semibold">
            {Number(jobs.data.today.tokens).toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            응답 없는 호출의 사용량은 포함되지 않습니다.
          </p>
        </section>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="jobs">
            <Activity className="size-4 mr-2" />
            {LAYER_NAMES.L2}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Cpu className="size-4 mr-2" />
            AI 설정
          </TabsTrigger>
          <TabsTrigger value="collectors">수집 상태</TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="pt-6">
          <form onSubmit={save} className="max-w-2xl space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">제공자</label>
                <Select
                  value={config.provider}
                  onValueChange={(v) => {
                    update("provider", v);
                    if (v === "nvidia")
                      update("baseUrl", "https://integrate.api.nvidia.com/v1");
                  }}
                >
                  <SelectTrigger aria-label="제공자">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nvidia">NVIDIA</SelectItem>
                    <SelectItem value="openai-compatible">
                      OpenAI 호환
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="model">
                  모델 ID
                </label>
                <Input
                  id="model"
                  required
                  value={config.model}
                  onChange={(e) => update("model", e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  update("model", "deepseek-ai/deepseek-v4-flash-0731");
                  update("reasoning", "none");
                }}
              >
                DeepSeek Flash · 기본
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  update("model", "moonshotai/kimi-k3");
                  update("reasoning", "low");
                }}
              >
                Kimi K3
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  update("model", "deepseek-ai/deepseek-v4-pro-0813");
                  update("reasoning", "none");
                }}
              >
                DeepSeek Pro
              </Button>
            </div>
            <div className="space-y-2">
              <label htmlFor="endpoint" className="text-sm font-medium">
                API 주소
              </label>
              <Input
                id="endpoint"
                type="url"
                required
                value={config.baseUrl}
                onChange={(e) => update("baseUrl", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="api-key" className="text-sm font-medium">
                API 키{" "}
                {settings.data.hasKey && (
                  <Badge variant="secondary">저장됨</Badge>
                )}
              </label>
              <Input
                id="api-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  settings.data.hasKey
                    ? "비워 두면 기존 키 유지"
                    : "API 키 입력"
                }
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">일일 시도 제한</label>
                <Select
                  value={config.dailyCalls === null ? "unlimited" : "limited"}
                  onValueChange={(v) =>
                    update(
                      "dailyCalls",
                      v === "unlimited" ? null : (config.dailyCalls ?? 100),
                    )
                  }
                >
                  <SelectTrigger aria-label="일일 시도 제한">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlimited">제한 없음</SelectItem>
                    <SelectItem value="limited">직접 설정</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  최대 20 RPM · 동시 실행 1개. 제공자 제한과 오류 대기는
                  유지합니다.
                </p>
              </div>
              {config.dailyCalls !== null && (
                <div className="space-y-2">
                  <label htmlFor="dailyCalls" className="text-sm font-medium">
                    일일 호출 한도
                  </label>
                  <Input
                    id="dailyCalls"
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={config.dailyCalls}
                    onChange={(e) =>
                      update("dailyCalls", Number(e.target.value))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    실패·중단을 포함한 정제 시도 수입니다.
                  </p>
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {(
                [
                  ["maxTokens", "최대 출력 토큰", 512, 16384],
                  ["maxInputTokens", "입력 예산 · 보수 추정", 3000, 32000],
                ] as const
              ).map(([key, label, min, max]) => (
                <div key={key} className="space-y-2">
                  <label htmlFor={key} className="text-sm font-medium">
                    {label}
                  </label>
                  <Input
                    id={key}
                    type="number"
                    min={min}
                    max={max}
                    required
                    value={config[key]}
                    onChange={(e) => update(key, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">추론 수준</label>
              <Select
                value={config.reasoning}
                onValueChange={(v) => update("reasoning", v)}
              >
                <SelectTrigger aria-label="추론 수준">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["default", "none", "low", "high", "max"]
                    .filter(
                      (v) =>
                        config.provider !== "nvidia" ||
                        (config.model.startsWith("deepseek-ai/deepseek-v4-")
                          ? v !== "low"
                          : config.model === "moonshotai/kimi-k3"
                            ? v !== "none"
                            : true),
                    )
                    .map((v) => (
                      <SelectItem key={v} value={v}>
                        {
                          (
                            {
                              default: "모델 기본값",
                              none: "사용 안 함",
                              low: "낮음",
                              high: "높음",
                              max: "최대",
                            } as any
                          )[v]
                        }
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              입력은 텍스트만 사용하며 UTF-8 바이트로 토큰 사용량을 보수적으로
              추정합니다. 실제 토큰은 호출 이력에서 확인합니다. Pro는 모델을
              직접 선택한 작업에 사용하며 자동으로 이중 호출하지 않습니다.
              저장한 설정은 다음 정제부터 적용됩니다. 진행 중인 작업은 시작 당시
              설정을 사용합니다. 호출 한도는 제공자의 무료 제공량이나 금액
              상한을 보장하지 않습니다.
            </p>
            {!!failure && <Failure error={failure} />}
            <div className="flex items-center gap-3">
              <Button disabled={busy}>
                <Save />
                {busy ? "저장 중" : "설정 저장"}
              </Button>
              {saved && (
                <span role="status" className="text-sm">
                  저장했습니다.
                </span>
              )}
            </div>
          </form>
        </TabsContent>
        <TabsContent value="jobs" className="pt-6">
          <RefinementSessions workspaceId={workspaceId} />
          <RefinementHealth data={jobs.data.health} />
          {!!jobs.data.runs.length && (
            <section className="mt-8">
              <h2 className="font-semibold mb-4">호출 이력</h2>
              <div className="divide-y border-y">
                {jobs.data.runs.map((r: any) => (
                  <CallHistoryRow key={r.id} run={r} />
                ))}
              </div>
            </section>
          )}
          <Pagination
            data={jobs.data.pagination.runs}
            pageKey="runsPage"
            label="호출 이력"
          />
        </TabsContent>
        <TabsContent value="collectors" className="pt-6">
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
                          {(Number(u.compressed_bytes) / 1048576).toFixed(2)} MB
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
              아직 수집한 세션이 없습니다. 에이전트 연결에서 원문 보관 권한의
              키를 발급해 Collector에 연결하세요.
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
                    <p key={i} className="mt-1 text-xs text-muted-foreground">
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
        <span className="inline-flex flex-wrap gap-x-2 gap-y-1 tabular-nums">
          {diagnostics?.requestedAt && <span>시도 {diagnostics.attempt}</span>}
          {diagnostics?.durationMs != null && (
            <span>{(diagnostics.durationMs / 1000).toFixed(1)}초</span>
          )}
          <span>
            {r.usage?.total_tokens?.toLocaleString() ?? "미집계"} 토큰
          </span>
          {diagnostics?.httpStatus != null && (
            <span title={`HTTP 요청 ${diagnostics.httpRequests ?? "미집계"}회`}>
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
              title={new Date(diagnostics.retryAt).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
              })}
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
  const attempts = data.models.reduce((n: number, m: any) => n + m.attempts, 0);
  const unmeasured = data.models.reduce(
    (n: number, m: any) => n + m.unmeasured,
    0,
  );
  return (
    <section className="mt-8" aria-label="최근 7일 정제 상태">
      <h2 className="font-semibold mb-3">최근 7일 정제 상태</h2>
      {!attempts && (
        <p className="text-sm text-muted-foreground">
          아직 측정된 모델 호출이 없습니다.
        </p>
      )}
      {!!attempts && (
        <div className="overflow-x-auto border-y">
          <table className="w-full text-sm min-w-[620px]">
            <thead className="text-muted-foreground">
              <tr>
                {[
                  "모델",
                  "호출 시도",
                  "정제 성공률",
                  "자동 재시도",
                  "평균 / 95% 소요 시간",
                ].map((x) => (
                  <th key={x} className="text-left font-normal py-3 pr-4">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.models
                .filter((m: any) => m.attempts > 0)
                .map((m: any) => (
                  <tr key={`${m.provider}/${m.model}`} className="border-t">
                    <td className="py-3 pr-4">
                      <span className="block text-xs text-muted-foreground">
                        {m.provider}
                      </span>
                      {m.model}
                    </td>
                    <td className="pr-4">{m.attempts}회</td>
                    <td className="pr-4">
                      {m.completed + m.failed
                        ? `${Math.round((100 * m.completed) / (m.completed + m.failed))}%`
                        : "—"}
                      <span className="block text-xs text-muted-foreground">
                        완료 {m.completed} · 실패 {m.failed} · 진행 {m.running}
                      </span>
                    </td>
                    <td className="pr-4">{m.retries}회</td>
                    <td>
                      {m.average_ms == null
                        ? "—"
                        : `${(m.average_ms / 1000).toFixed(1)}초 / ${(m.p95_ms / 1000).toFixed(1)}초`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-2">
        성공률은 모델 호출 후 정제 완료 여부로 계산하며 진행 중인 실행은
        제외합니다. 소요 시간은 모델 응답·결과 조회 대기를 포함합니다.
        {unmeasured > 0 &&
          ` 이전 기록 ${unmeasured}건은 측정값이 없어 통계에서 제외합니다.`}
      </p>
      {!!data.errors.length && (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-medium">반복 오류 · 상위 10개</h3>
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
                  · {stages[e.stage] ?? "단계 미집계"} · {e.provider} /{" "}
                  {e.model}
                </span>
              </div>
              <span className="text-muted-foreground">
                최근 <When value={e.last_seen} compact />
              </span>
            </div>
          ))}
        </div>
      )}
      {!!attempts && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            일별 기록
          </summary>
          <div className="mt-2 divide-y">
            {data.daily.map((d: any) => (
              <div
                key={d.day}
                className="flex flex-wrap justify-between gap-2 py-2 text-xs"
              >
                <span>{d.day} (UTC)</span>
                <span className="flex flex-wrap items-center gap-2">
                  시도 {d.attempts}
                  <StatusBadge status="completed">
                    완료 {d.completed}
                  </StatusBadge>
                  <StatusBadge status="failed">실패 {d.failed}</StatusBadge>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
