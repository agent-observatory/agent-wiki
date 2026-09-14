"use client";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Cpu, KeyRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { api, errorText, useApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Heading, Loading, Failure } from "./common";
import { Connections } from "./connections";

type Mode = "byok";
type Config = {
  version: number;
  hasKey: boolean;
  stoppedReason?: string | null;
  stoppedAt?: string | null;
  fallbackActive?: boolean;
  fallbackActiveSince?: string | null;
  activeModel?: string;
  mode: Mode;
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  fallbackModel: string | null;
  dailyCalls: number | null;
  requestsPerMinute: number;
  concurrency: number;
  retryDelaySeconds: number;
  maxTokens: number;
  enable_thinking?: boolean;
  thinking_budget?: number | null;
  max_completion_tokens?: number | null;
  maxInputChars: number;
  maxInputTokens: number;
  reasoning: string;
};

export function Settings() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useSearchParams();
  const router = useRouter();
  const tab = query.get("tab") === "client" ? "client" : "ai";
  return (
    <>
      <Heading title="설정" />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          router.push(`?tab=${value}`, { scroll: false })
        }
      >
        <TabsList>
          <TabsTrigger value="ai">
            <Cpu className="size-4 mr-2" />
            AI 연결
          </TabsTrigger>
          <TabsTrigger value="client">
            <KeyRound className="size-4 mr-2" />
            Client 연결
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ai" className="pt-6">
          <AIConnection key={workspaceId} />
        </TabsContent>
        <TabsContent value="client" className="pt-6">
          <Connections />
        </TabsContent>
      </Tabs>
    </>
  );
}
function AIConnection() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [editing, setEditing] = useState(false);
  const settings = useApi(`/api/workspaces/${workspaceId}/ai-settings`, 15000);
  if (settings.error) return <Failure error={settings.error} />;
  if (!settings.data) return <Loading />;
  const config = settings.data as Config;
  if (editing)
    return (
      <AIConnectionForm
        key={workspaceId}
        config={config}
        base={`/api/workspaces/${workspaceId}/ai-settings`}
        onClose={() => {
          setEditing(false);
          settings.reload();
        }}
      />
    );
  const thinking = config.enable_thinking ?? config.reasoning !== "none";
  const settingsRows: [string, string | number][] = [
    ["Endpoint", config.baseUrl],
    ["model", config.model],
    ["fallback model", config.fallbackModel ?? "없음"],
    ["maxInputTokens", config.maxInputTokens],
    config.max_completion_tokens !== undefined
      ? [
          "max_completion_tokens",
          config.max_completion_tokens ?? "Provider default",
        ]
      : ["max_tokens", config.maxTokens],
    ["enable_thinking", thinking ? "true" : "false"],
    ...(thinking && !["none", "default"].includes(config.reasoning)
      ? [["reasoning_effort", config.reasoning] as [string, string]]
      : []),
    ...(thinking && config.thinking_budget != null
      ? [["thinking_budget", config.thinking_budget] as [string, number]]
      : []),
    ["requestsPerMinute", config.requestsPerMinute],
    ["concurrency", config.concurrency],
    ...(config.dailyCalls != null
      ? [["dailyCalls", config.dailyCalls] as [string, number]]
      : []),
  ];
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Badge variant="outline">BYOK</Badge>
        <Button
          className="ml-auto"
          variant="outline"
          onClick={() => setEditing(true)}
        >
          편집
        </Button>
        <span className="inline-flex items-center gap-2 text-sm">
          <CheckCircle2
            className={
              settings.data.hasKey
                ? "size-4 text-emerald-500"
                : "size-4 text-muted-foreground"
            }
          />
          {settings.data.hasKey ? "키 연결됨" : "키 없음"}
        </span>
      </div>
      {config.stoppedReason && (
        <p
          role="status"
          className="mb-4 text-sm text-amber-700 dark:text-amber-400"
        >
          무료 한도 소진으로 정제가 중지됐습니다. 모델·한도를 확인한 뒤 직접
          재개하세요.
        </p>
      )}
      {config.fallbackActive && (
        <p
          role="status"
          className="mb-4 text-sm text-amber-700 dark:text-amber-400"
        >
          1번 모델의 무료 한도가 소진되어 2번 모델 {config.activeModel}로 정제
          중입니다. 2번 모델을 1번으로 올리고 새 2번 모델을 저장하면 1번부터
          다시 사용합니다.
        </p>
      )}
      <dl className="divide-y border-y">
        {settingsRows.map(([key, value]) => (
          <div
            key={key}
            className="grid grid-cols-[220px_1fr] gap-6 py-3 text-sm"
          >
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="break-all">
              {typeof value === "number" ? value.toLocaleString() : value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function AIConnectionForm({
  config: receivedConfig,
  base,
  onClose,
}: {
  config: Config;
  base: string;
  onClose: () => void;
}) {
  const [config] = useState(receivedConfig);
  const [draft, setDraft] = useState(config);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<unknown>();
  const [tested, setTested] = useState<string>();
  function update(field: keyof Config, value: unknown) {
    setDraft((d) => ({ ...d, [field]: value }));
    setTested(undefined);
    setError(undefined);
  }
  async function submit(
    action: "save" | "test",
    target: "primary" | "fallback" = "primary",
  ) {
    if (busy) return;
    setBusy(action);
    setError(undefined);
    setTested(undefined);
    const {
      hasKey,
      version,
      stoppedReason,
      stoppedAt,
      fallbackActive,
      fallbackActiveSince,
      activeModel,
      ...values
    } = draft;
    const fallbackModel = values.fallbackModel?.trim() || null;
    try {
      const result = await api(base + (action === "test" ? "/test" : ""), {
        method: action === "test" ? "POST" : "PUT",
        body: JSON.stringify({
          config: { ...values, fallbackModel, enabled: config.enabled },
          version: config.version,
          ...(key.trim() ? { apiKey: key.trim() } : {}),
          ...(action === "test" ? { target } : {}),
        }),
      });
      if (action === "save") {
        setKey("");
        onClose();
      } else
        setTested(
          `Hello · ${result.model} 연결 성공 ${(result.durationMs / 1000).toFixed(1)}초`,
        );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  const field = (
    name: keyof Config,
    label: string,
    min?: number,
    max?: number,
  ) => (
    <label
      key={name}
      className="grid grid-cols-[220px_1fr] items-center gap-6 py-3 text-sm"
    >
      <span>{label}</span>
      <Input
        type={min === undefined ? "text" : "number"}
        min={min}
        max={max}
        value={String(draft[name] ?? "")}
        onChange={(e) =>
          update(
            name,
            min === undefined
              ? e.target.value
              : e.target.value === ""
                ? null
                : Number(e.target.value),
          )
        }
      />
    </label>
  );
  const thinking = draft.enable_thinking ?? draft.reasoning !== "none";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit("save");
      }}
      className="max-w-3xl"
    >
      <fieldset disabled={!!busy} className="divide-y border-y">
        {field("baseUrl", "Endpoint")}
        {field("model", "model")}
        {field("fallbackModel", "fallback model · 비우면 없음")}
        <label className="grid grid-cols-[220px_1fr] items-center gap-6 py-3 text-sm">
          <span>API key</span>
          <Input
            type="password"
            autoComplete="off"
            value={key}
            placeholder={config.hasKey ? "저장된 키 유지" : "API key 입력"}
            onChange={(e) => {
              setKey(e.target.value);
              setTested(undefined);
            }}
          />
        </label>
        <details className="py-3">
          <summary className="cursor-pointer text-sm">고급 설정</summary>
          {field("maxInputTokens", "maxInputTokens", 3000, 32000)}
          {draft.max_completion_tokens !== undefined
            ? field(
                "max_completion_tokens",
                "max_completion_tokens · 비우면 기본값",
                512,
                32768,
              )
            : field("maxTokens", "max_tokens", 512, 16384)}
          <label className="flex items-center justify-between py-3 text-sm">
            enable_thinking
            <input
              type="checkbox"
              checked={thinking}
              onChange={(e) => update("enable_thinking", e.target.checked)}
            />
          </label>
          {thinking && (
            <>
              <label className="grid grid-cols-[220px_1fr] items-center gap-6 py-3 text-sm">
                <span>reasoning_effort</span>
                <Select
                  disabled={!!busy}
                  value={draft.reasoning}
                  onValueChange={(value) => update("reasoning", value)}
                >
                  <SelectTrigger aria-label="reasoning_effort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(/qwen/.test(draft.model)
                      ? ["default", "none"]
                      : /deepseek-v4/.test(draft.model)
                        ? ["default", "none", "high", "max"]
                        : ["default", "none", "low", "high"]
                    ).map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {field("thinking_budget", "thinking_budget · 선택", 1, 32768)}
            </>
          )}
          {field("requestsPerMinute", "requestsPerMinute", 1, 120)}
          {field("concurrency", "concurrency", 1, 5)}
          {field("retryDelaySeconds", "retryDelaySeconds", 5, 600)}
          {field("dailyCalls", "dailyCalls · 선택", 1, 1000)}
        </details>
      </fieldset>
      {error != null && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {errorText(error)}
        </p>
      )}
      {tested && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          <CheckCircle2 className="size-4" />
          {tested}
        </p>
      )}
      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" disabled={!!busy}>
          {busy === "save" ? "저장 중" : "저장"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!!busy}
          onClick={() => submit("test")}
        >
          {busy === "test" ? "연결 확인 중" : "연결 테스트"}
        </Button>
        {draft.fallbackModel?.trim() && (
          <Button
            type="button"
            variant="outline"
            disabled={!!busy}
            onClick={() => submit("test", "fallback")}
          >
            2번 모델 테스트
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={!!busy}
          onClick={onClose}
        >
          취소
        </Button>
        <span className="ml-2 text-xs text-muted-foreground">
          저장·테스트는 정제를 시작하지 않습니다.
        </span>
      </div>
    </form>
  );
}
