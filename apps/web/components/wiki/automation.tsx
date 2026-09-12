"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Save, RefreshCw, Play, Pause, Cpu, Activity } from "lucide-react";
import { RefinementProgress, waitingReasons } from "./refinement-progress";
import { Progress } from "@/components/ui/progress";
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
  dailyCalls: number;
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
  REVISION_CONFLICT: "기존 지식의 개정이 변경됐습니다.",
};
export function Automation() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const base = "/api/workspaces/" + workspaceId;
  const [tab, setTab] = useState("jobs");
  const settings = useApi(base + "/ai-settings"),
    jobs = useApi(base + "/refinements", 15000);
  const [config, setConfig] = useState<Config>(),
    [apiKey, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings.data) {
      const { hasKey, version, ...value } = settings.data;
      setConfig(value);
    }
  }, [settings.data]);
  const update = (name: keyof Config, value: string | number | boolean) => {
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
          config,
          version: settings.data.version,
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      setKey("");
      setSaved(true);
      settings.reload();
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
        title="수집·AI 정제"
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
          <div className="flex gap-2 items-center mt-3 font-semibold">
            {settings.data.enabled ? (
              <Play className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
            {settings.data.enabled ? "활성" : "일시 중지"}
          </div>
        </section>
        <section className="rounded-lg border p-5">
          <p className="text-sm text-muted-foreground">오늘 정제 시도 / 한도</p>
          <p className="mt-3 text-xl font-semibold">
            {jobs.data.today.calls} / {settings.data.dailyCalls}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            실패·중단 시도 포함 · UTC 자정 초기화
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
            정제 작업
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Cpu className="size-4 mr-2" />
            AI 설정
          </TabsTrigger>
          <TabsTrigger value="collectors">수집 상태</TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="pt-6">
          <form onSubmit={save} className="max-w-2xl space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">자동 정제</label>
              <Select
                value={String(config.enabled)}
                onValueChange={(v) => update("enabled", v === "true")}
              >
                <SelectTrigger aria-label="자동 정제">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">
                    일시 중지 · 원문 수집은 계속
                  </SelectItem>
                  <SelectItem value="true">
                    활성 · 외부 AI로 텍스트 전송
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
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
            <div className="grid sm:grid-cols-3 gap-4">
              {(
                [
                  ["dailyCalls", "일일 호출 한도", 1, 1000],
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
          <p className="mb-4 text-xs text-muted-foreground">
            전체 {jobs.data.progress.summary.total.toLocaleString()}자료 중{" "}
            {jobs.data.items.length}개 표시 · 진행·재시도·확인 필요 작업 우선
          </p>
          {!jobs.data.items.length ? (
            <Empty>수집한 원문이 들어오면 정제 작업이 표시됩니다.</Empty>
          ) : (
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
                  {jobs.data.items.map((job: any) => (
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
                            반영한 지식 · 개정 {a.revision}
                          </Link>
                        ))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            job.status === "failed"
                              ? "destructive"
                              : "secondary"
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
                            <p>
                              {
                                waitingReasons[
                                  jobs.data.progress.schedule.reason
                                ]
                              }
                            </p>
                            {!["paused", "key_missing"].includes(
                              jobs.data.progress.schedule.reason,
                            ) &&
                              (new Date(job.available_at).getTime() >
                                Date.now() ||
                                jobs.data.progress.schedule.nextAttemptAt) && (
                                <p className="text-muted-foreground">
                                  <When
                                    value={new Date(
                                      Math.max(
                                        new Date(job.available_at).getTime(),
                                        new Date(
                                          jobs.data.progress.schedule
                                            .nextAttemptAt ?? 0,
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
                                jobs.reload();
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
          )}
          {!!failure && <Failure error={failure} />}
          {!!jobs.data.runs.length && (
            <section className="mt-8">
              <h2 className="font-semibold mb-4">호출 이력</h2>
              <div className="divide-y border-y">
                {jobs.data.runs.map((r: any) => (
                  <div
                    key={r.id}
                    className="py-4 flex flex-wrap gap-3 justify-between"
                  >
                    <div>
                      <p className="text-sm">
                        {r.settings.provider} · {r.settings.model}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {r.prompt_version} · {statuses[r.status] ?? r.status} ·{" "}
                        {r.usage?.total_tokens ?? "미집계"} 토큰
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      <When value={r.created_at} />
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
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
                          <Badge
                            variant={
                              u.status === "failed"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {statuses[u.status] ?? u.status}
                          </Badge>
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
          {!jobs.data.streams.length ? (
            <Empty>
              아직 수집한 세션이 없습니다. 에이전트 연결에서 원문 보관 권한의
              키를 발급해 Collector에 연결하세요.
            </Empty>
          ) : (
            <div className="divide-y border-y">
              {jobs.data.streams.map((s: any) => (
                <div key={s.id} className="py-4">
                  <p>
                    {s.name} <Badge variant="outline">{s.client}</Badge>
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    최근 수신 <When value={s.updated_at} />
                  </p>
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
        </TabsContent>
      </Tabs>
    </>
  );
}
