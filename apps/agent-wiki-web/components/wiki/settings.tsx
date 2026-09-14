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
// One model's own parameters: the primary and fallback slots each carry an
// independent copy, only baseUrl/key and the rate limits below are shared.
type ModelSlot = {
  model: string;
  enable_thinking?: boolean;
  thinking_budget?: number | null;
  max_completion_tokens?: number | null;
  maxTokens: number;
  maxInputTokens: number;
  maxInputChars: number;
  reasoning: string;
  timeoutSeconds: number;
};
const emptySlot: ModelSlot = {
  model: "",
  maxTokens: 2048,
  maxInputTokens: 8000,
  maxInputChars: 24000,
  reasoning: "none",
  timeoutSeconds: 330,
};
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
  dailyCalls: number | null;
  requestsPerMinute: number;
  concurrency: number;
  retryDelaySeconds: number;
  primary: ModelSlot;
  fallback: ModelSlot | null;
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
function slotRows(slot: ModelSlot): [string, string | number][] {
  const thinking = slot.enable_thinking ?? slot.reasoning !== "none";
  return [
    ["model", slot.model],
    ["timeoutSeconds", slot.timeoutSeconds],
    ["maxInputTokens", slot.maxInputTokens],
    slot.max_completion_tokens !== undefined
      ? ["max_completion_tokens", slot.max_completion_tokens ?? "Provider default"]
      : ["max_tokens", slot.maxTokens],
    ["enable_thinking", thinking ? "true" : "false"],
    ...(thinking && !["none", "default"].includes(slot.reasoning)
      ? [["reasoning_effort", slot.reasoning] as [string, string]]
      : []),
    ...(thinking && slot.thinking_budget != null
      ? [["thinking_budget", slot.thinking_budget] as [string, number]]
      : []),
  ];
}
function SlotList({ title, slot }: { title: string; slot: ModelSlot | null }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>
      {slot ? (
        <dl className="divide-y border-y">
          {slotRows(slot).map(([key, value]) => (
            <div key={key} className="grid grid-cols-[160px_1fr] gap-4 py-3 text-sm">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-all">
                {typeof value === "number" ? value.toLocaleString() : value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="border-y py-3 text-sm text-muted-foreground">설정 안 됨</p>
      )}
    </div>
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
  const sharedRows: [string, string | number][] = [
    ["Endpoint", config.baseUrl],
    ["requestsPerMinute", config.requestsPerMinute],
    ["concurrency", config.concurrency],
    ["retryDelaySeconds", config.retryDelaySeconds],
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
      <dl className="mb-6 divide-y border-y">
        {sharedRows.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[220px_1fr] gap-6 py-3 text-sm">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="break-all">
              {typeof value === "number" ? value.toLocaleString() : value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-2 gap-8">
        <SlotList title="모델 1 (기본)" slot={config.primary} />
        <SlotList title="모델 2 (폴백)" slot={config.fallback} />
      </div>
    </>
  );
}

function reasoningOptions(model: string) {
  return /qwen/.test(model)
    ? ["default", "none"]
    : /deepseek-v4/.test(model)
      ? ["default", "none", "high", "max"]
      : ["default", "none", "low", "high"];
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
  function updateShared(field: keyof Config, value: unknown) {
    setDraft((d) => ({ ...d, [field]: value }));
    setTested(undefined);
    setError(undefined);
  }
  function updateSlot(
    slot: "primary" | "fallback",
    field: keyof ModelSlot,
    value: unknown,
  ) {
    setDraft((d) => {
      const current = d[slot];
      return current ? { ...d, [slot]: { ...current, [field]: value } } : d;
    });
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
    try {
      const result = await api(base + (action === "test" ? "/test" : ""), {
        method: action === "test" ? "POST" : "PUT",
        body: JSON.stringify({
          config: { ...values, enabled: config.enabled },
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
  const sharedField = (
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
          updateShared(
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
  function slotField(
    slotName: "primary" | "fallback",
    data: ModelSlot,
    name: keyof ModelSlot,
    label: string,
    min?: number,
    max?: number,
  ) {
    return (
      <label
        key={name}
        className="grid grid-cols-[140px_1fr] items-center gap-4 py-3 text-sm"
      >
        <span>{label}</span>
        <Input
          type={min === undefined ? "text" : "number"}
          min={min}
          max={max}
          value={String(data[name] ?? "")}
          onChange={(e) =>
            updateSlot(
              slotName,
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
  }
  function SlotFields({
    slotName,
    data,
  }: {
    slotName: "primary" | "fallback";
    data: ModelSlot;
  }) {
    const thinking = data.enable_thinking ?? data.reasoning !== "none";
    return (
      <div className="divide-y">
        {slotField(slotName, data, "model", "model")}
        {slotField(slotName, data, "timeoutSeconds", "timeoutSeconds(초)", 60, 900)}
        {slotField(slotName, data, "maxInputTokens", "maxInputTokens", 3000, 32000)}
        {data.max_completion_tokens !== undefined
          ? slotField(
              slotName,
              data,
              "max_completion_tokens",
              "max_completion_tokens · 비우면 기본값",
              512,
              32768,
            )
          : slotField(slotName, data, "maxTokens", "max_tokens", 512, 16384)}
        <label className="flex items-center justify-between py-3 text-sm">
          enable_thinking
          <input
            type="checkbox"
            checked={thinking}
            onChange={(e) => updateSlot(slotName, "enable_thinking", e.target.checked)}
          />
        </label>
        {thinking && (
          <>
            <label className="grid grid-cols-[140px_1fr] items-center gap-4 py-3 text-sm">
              <span>reasoning_effort</span>
              <Select
                disabled={!!busy}
                value={data.reasoning}
                onValueChange={(value) => updateSlot(slotName, "reasoning", value)}
              >
                <SelectTrigger aria-label={slotName + "-reasoning_effort"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reasoningOptions(data.model).map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {slotField(slotName, data, "thinking_budget", "thinking_budget · 선택", 1, 32768)}
          </>
        )}
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit("save");
      }}
      className="max-w-4xl"
    >
      <fieldset disabled={!!busy} className="divide-y border-y">
        {sharedField("baseUrl", "Endpoint")}
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
        {sharedField("requestsPerMinute", "requestsPerMinute", 1, 120)}
        {sharedField("concurrency", "concurrency", 1, 5)}
        {sharedField("retryDelaySeconds", "retryDelaySeconds", 5, 600)}
        {sharedField("dailyCalls", "dailyCalls · 선택", 1, 1000)}
        <label className="grid grid-cols-[220px_1fr] items-center gap-6 py-3 text-sm">
          <span>maxInputChars(1번)</span>
          <Input
            type="number"
            min={2000}
            max={60000}
            value={String(draft.primary.maxInputChars ?? "")}
            onChange={(e) =>
              updateSlot(
                "primary",
                "maxInputChars",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </label>
      </fieldset>
      <div className="mt-6 grid grid-cols-2 gap-8">
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">모델 1 (기본)</h3>
          <SlotFields slotName="primary" data={draft.primary} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">모델 2 (폴백)</h3>
            {draft.fallback ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => updateShared("fallback", null)}
              >
                제거
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => updateShared("fallback", emptySlot)}
              >
                추가
              </Button>
            )}
          </div>
          {draft.fallback ? (
            <SlotFields slotName="fallback" data={draft.fallback} />
          ) : (
            <p className="py-3 text-sm text-muted-foreground">
              비우면 1번 모델의 무료 한도 소진 시 안전 중지됩니다.
            </p>
          )}
        </div>
      </div>
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
        {draft.fallback?.model?.trim() && (
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
