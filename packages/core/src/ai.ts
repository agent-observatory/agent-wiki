import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { createRequire } from "node:module";
import type { Agent as ModelAgent } from "undici";
import { AppError } from "./db.js";
// The pinned Undici package's root entry installs a global dispatcher, which
// breaks OCI signed requests. Load only Agent and guard this boundary in tests.
const Agent: typeof ModelAgent = createRequire(import.meta.url)(
  "undici/lib/dispatcher/agent.js",
);
// Keep HTTP inactivity limits above the Worker's total 330-second deadline.
// Scope this dispatcher to model traffic; other application requests keep theirs.
const modelTransport = {
  dispatcher: new Agent().compose(
    (dispatch) => (options, handler) =>
      dispatch(
        { ...options, headersTimeout: 360_000, bodyTimeout: 360_000 },
        handler,
      ),
  ),
};
export const aiConfig = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.literal("byok").default("byok"),
    provider: z
      .enum(["nvidia", "openai-compatible"])
      .default("openai-compatible"),
    baseUrl: z
      .string()
      .url()
      .default("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
    model: z.string().min(1).max(160).default("deepseek-v4-flash"),
    // Second model on the same endpoint and key. When the first model's free
    // quota is exhausted the Worker continues on this one instead of stopping;
    // null means no fallback and the existing safety stop applies.
    fallbackModel: z.string().trim().min(1).max(160).nullable().default(null),
    dailyCalls: z.number().int().min(1).max(1000).nullable().default(null),
    requestsPerMinute: z.number().int().min(1).max(120).default(20),
    concurrency: z.number().int().min(1).max(5).default(1),
    retryDelaySeconds: z.number().int().min(5).max(600).default(120),
    enable_thinking: z.boolean().optional(),
    thinking_budget: z.number().int().min(1).max(32768).nullable().optional(),
    // Alibaba: null deliberately omits both output-cap fields; absent uses maxTokens.
    max_completion_tokens: z
      .number()
      .int()
      .min(512)
      .max(32768)
      .nullable()
      .optional(),
    maxTokens: z.number().int().min(512).max(16384).default(2048),
    maxInputTokens: z.number().int().min(3000).max(32000).default(8000),
    maxInputChars: z.number().int().min(2000).max(60000).default(24000),
    reasoning: z
      .enum(["default", "none", "low", "high", "max"])
      .default("none"),
  })
  .strict();
export type AiConfig = z.infer<typeof aiConfig>;
export const defaults = aiConfig.parse({});
export function isAlibabaQwen(config: AiConfig) {
  return (
    config.provider === "openai-compatible" &&
    new URL(config.baseUrl).hostname.endsWith(".aliyuncs.com") &&
    /^qwen3\.[5-8]-(flash|plus|max)(?:-|$)/.test(config.model)
  );
}
export function isAlibabaDeepSeek(config: AiConfig) {
  return (
    config.provider === "openai-compatible" &&
    new URL(config.baseUrl).hostname.endsWith(".aliyuncs.com") &&
    /^deepseek-v4-(flash|pro)(?:-\d{4})?$/.test(config.model)
  );
}
export function isAlibabaThinkingModel(config: AiConfig) {
  return isAlibabaQwen(config) || isAlibabaDeepSeek(config);
}
// The model the Worker actually calls: the fallback once the first model's
// free quota is exhausted for this Workspace, otherwise the configured model.
export function effectiveModelConfig(
  config: AiConfig,
  fallbackActive: boolean,
): AiConfig {
  return fallbackActive && config.fallbackModel
    ? { ...config, model: config.fallbackModel }
    : config;
}
export function validateEndpoint(config: AiConfig) {
  if (config.fallbackModel !== null) {
    if (config.fallbackModel === config.model)
      throw new AppError(400, "AI_FALLBACK_SAME_MODEL");
    validateEndpoint({
      ...config,
      model: config.fallbackModel,
      fallbackModel: null,
    });
  }
  if (
    !isAlibabaThinkingModel(config) &&
    (config.enable_thinking !== undefined ||
      config.thinking_budget != null ||
      config.max_completion_tokens != null)
  )
    throw new AppError(400, "AI_REASONING_NOT_SUPPORTED");
  if (isAlibabaQwen(config) && !["none", "default"].includes(config.reasoning))
    throw new AppError(400, "AI_REASONING_NOT_SUPPORTED");
  if (
    isAlibabaDeepSeek(config) &&
    !["none", "default", "high", "max"].includes(config.reasoning)
  )
    throw new AppError(400, "AI_REASONING_NOT_SUPPORTED");
  if (
    config.provider === "nvidia" &&
    ((config.model.startsWith("deepseek-ai/deepseek-v4-") &&
      config.reasoning === "low") ||
      (config.model === "moonshotai/kimi-k3" && config.reasoning === "none"))
  )
    throw new AppError(400, "AI_REASONING_NOT_SUPPORTED");
  const url = new URL(config.baseUrl);
  const hosts = (
    process.env.AI_ALLOWED_HOSTS ??
    "integrate.api.nvidia.com,api.deepseek.com,dashscope-intl.aliyuncs.com"
  ).split(",");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !hosts.includes(url.hostname)
  )
    throw new AppError(400, "AI_ENDPOINT_NOT_ALLOWED");
  if (
    config.provider === "nvidia" &&
    url.hostname !== "integrate.api.nvidia.com"
  )
    throw new AppError(400, "AI_ENDPOINT_NOT_ALLOWED");
}
function key() {
  const v = process.env.AI_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(v))
    throw new AppError(503, "AI_ENCRYPTION_NOT_CONFIGURED");
  return Buffer.from(v, "hex");
}
export function encryptSecret(secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((x) => x.toString("base64"))
    .join(".");
}
export function decryptSecret(value: string) {
  const [iv, tag, body] = value.split(".").map((x) => Buffer.from(x, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
export class ModelError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public retryAfter: number | null = null,
  ) {
    super(code);
  }
}
export function parseRetryAfter(value: string | null, now = Date.now()) {
  if (!value) return null;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : null;
}
export type ModelObservation =
  | { type: "poll" }
  | { type: "response"; status: number }
  | { type: "completion"; finishReason?: string; outputChars: number }
  | { type: "usage"; usage: Record<string, unknown> };
export async function callModel(
  config: AiConfig,
  secret: string,
  messages: unknown[],
  signal: AbortSignal,
  beforePoll?: () => Promise<void>,
  observe?: (event: ModelObservation) => void,
) {
  validateEndpoint(config);
  let response = await fetch(
    config.baseUrl.replace(/\/$/, "") + "/chat/completions",
    {
      ...modelTransport,
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        authorization: "Bearer " + secret,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        // Every caller expects a JSON object (curation or the Hello test).
        ...(isAlibabaThinkingModel(config)
          ? { response_format: { type: "json_object" } }
          : {}),
        ...(isAlibabaThinkingModel(config) &&
        config.max_completion_tokens === null
          ? {}
          : isAlibabaThinkingModel(config) &&
              config.max_completion_tokens !== undefined
            ? { max_completion_tokens: config.max_completion_tokens }
            : { max_tokens: config.maxTokens }),
        ...(isAlibabaThinkingModel(config) &&
        config.enable_thinking !== undefined
          ? { enable_thinking: config.enable_thinking }
          : {}),
        ...(isAlibabaThinkingModel(config) &&
        (config.enable_thinking ?? config.reasoning !== "none") &&
        config.thinking_budget != null
          ? { thinking_budget: config.thinking_budget }
          : {}),
        ...(config.reasoning === "default" ||
        (isAlibabaThinkingModel(config) && config.enable_thinking !== undefined)
          ? {}
          : isAlibabaThinkingModel(config) && config.reasoning === "none"
            ? { enable_thinking: false }
            : config.provider === "nvidia" &&
                config.model.startsWith("deepseek-ai/deepseek-v4-")
              ? {
                  chat_template_kwargs:
                    config.reasoning === "none"
                      ? { thinking: false }
                      : { thinking: true, reasoning_effort: config.reasoning },
                }
              : { reasoning_effort: config.reasoning }),
        ...(isAlibabaDeepSeek(config) &&
        (config.enable_thinking ?? config.reasoning !== "none") &&
        ["high", "max"].includes(config.reasoning)
          ? { reasoning_effort: config.reasoning }
          : {}),
      }),
    },
  );
  observe?.({ type: "response", status: response.status });
  if (response.status === 202 && config.provider === "nvidia") {
    const headerId = response.headers.get("nvcf-reqid");
    const pending = (await response.json().catch(() => ({}))) as {
      requestId?: string;
    };
    const id = headerId ?? pending.requestId;
    if (!id || !/^[a-f0-9-]{36}$/i.test(id))
      throw new ModelError("AI_PENDING_ID_MISSING");
    // The caller owns the total deadline. A fixed poll count would end a slow
    // pending request before that deadline and start another inference later.
    while (response.status === 202) {
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", aborted);
          resolve();
        }, 2000);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
      });
      await beforePoll?.();
      signal.throwIfAborted();
      observe?.({ type: "poll" });
      response = await fetch(
        config.baseUrl.replace(/\/$/, "") + "/status/" + id,
        {
          ...modelTransport,
          headers: { authorization: "Bearer " + secret },
          redirect: "error",
          signal,
        },
      );
      observe?.({ type: "response", status: response.status });
      if (response.status === 202) await response.body?.cancel();
    }
  }
  if (!response.ok || response.status === 202) {
    // Read only a bounded error envelope; never retain provider prose or secrets.
    let providerCode: unknown;
    if (
      response.status === 403 &&
      new URL(config.baseUrl).hostname.endsWith(".aliyuncs.com")
    ) {
      const reader = response.body?.getReader();
      if (reader) {
        const parts: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            bytes += item.value.length;
            if (bytes > 16384) break;
            parts.push(item.value);
          }
          if (bytes <= 16384) {
            const body = JSON.parse(Buffer.concat(parts).toString());
            providerCode = body.error?.code ?? body.code;
          }
        } catch {
        } finally {
          await reader.cancel().catch(() => {});
        }
      }
    } else await response.body?.cancel();
    if (providerCode === "AllocationQuota.FreeTierOnly")
      throw new ModelError("AI_FREE_QUOTA_EXHAUSTED");
    throw new ModelError(
      "AI_HTTP_" + response.status,
      response.status === 202 ||
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > 2_000_000) throw new ModelError("AI_RESPONSE_TOO_LARGE");
    chunks.push(chunk);
  }
  let data: any;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ModelError("AI_INVALID_RESPONSE");
  }
  const usage = z
    .object({
      prompt_tokens: z.number().nonnegative().optional(),
      completion_tokens: z.number().nonnegative().optional(),
      total_tokens: z.number().nonnegative().optional(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().nonnegative().optional() })
        .optional(),
      completion_tokens_details: z
        .object({ reasoning_tokens: z.number().nonnegative().optional() })
        .optional(),
    })
    .parse(data.usage ?? {});
  observe?.({ type: "usage", usage });
  const choice = data.choices?.[0];
  observe?.({
    type: "completion",
    finishReason:
      typeof choice?.finish_reason === "string"
        ? choice.finish_reason
        : undefined,
    outputChars:
      typeof choice?.message?.content === "string"
        ? choice.message.content.length
        : 0,
  });
  if (choice?.finish_reason === "length")
    throw new ModelError("AI_OUTPUT_LIMIT");
  if (typeof choice?.message?.content !== "string")
    throw new ModelError("AI_EMPTY_RESPONSE");
  let output: unknown;
  try {
    output = JSON.parse(
      choice.message.content
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new ModelError("AI_INVALID_JSON");
  }
  return { output, usage };
}
