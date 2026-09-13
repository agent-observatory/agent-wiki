"use client";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Cpu, KeyRound } from "lucide-react";
import { useApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Heading, Loading, Failure } from "./common";
import { Connections } from "./connections";

type Mode = "byok";
type Config = {
  mode: Mode;
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
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
          <AIConnection />
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
  const settings = useApi(`/api/workspaces/${workspaceId}/ai-settings`, 15000);
  if (settings.error) return <Failure error={settings.error} />;
  if (!settings.data) return <Loading />;
  const config = settings.data as Config;
  const thinking = config.enable_thinking ?? config.reasoning !== "none";
  const settingsRows: [string, string | number][] = [
    ["model", config.model],
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
