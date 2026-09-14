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
// Keep HTTP inactivity limits above whichever model slot's own call deadline
// applies; cached per distinct timeoutSeconds so calls at the same deadline
// still share one connection pool. Scoped to model traffic only.
function buildTransport(ms: number) {
  return {
    dispatcher: new Agent().compose(
      (dispatch) => (options, handler) =>
        dispatch({ ...options, headersTimeout: ms, bodyTimeout: ms }, handler),
    ),
  };
}
const transportCache = new Map<number, ReturnType<typeof buildTransport>>();
function modelTransport(timeoutSeconds: number) {
  let entry = transportCache.get(timeoutSeconds);
  if (!entry) {
    entry = buildTransport(timeoutSeconds * 1000 + 30_000);
    transportCache.set(timeoutSeconds, entry);
  }
  return entry;
}
// Per-model-slot parameters: everything that can differ between the first
// (primary) and second (fallback) model on the same endpoint and key.
export const modelParams = z
  .object({
    model: z.string().min(1).max(160),
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
    // Per-call HTTP deadline for this model slot. A generously slow model
    // (e.g. a heavier reasoning snapshot) can be given more room without
    // raising the deadline for a faster one on the other slot.
    timeoutSeconds: z.number().int().min(60).max(900).default(330),
  })
  .strict();
export type ModelParams = z.infer<typeof modelParams>;
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
    dailyCalls: z.number().int().min(1).max(1000).nullable().default(null),
    requestsPerMinute: z.number().int().min(1).max(120).default(20),
    concurrency: z.number().int().min(1).max(5).default(1),
    retryDelaySeconds: z.number().int().min(5).max(600).default(120),
    primary: modelParams.default({
      model: "deepseek-v4-flash",
      maxTokens: 2048,
      maxInputTokens: 8000,
      maxInputChars: 24000,
      reasoning: "none",
      timeoutSeconds: 330,
    }),
    // At most one fallback: the Worker only ever calls these two model slots.
    // When the first model's free quota is exhausted the Worker continues on
    // this one instead of stopping; null means no fallback and the existing
    // safety stop applies.
    fallback: modelParams.nullable().default(null),
  })
  .strict();
export type AiConfig = z.infer<typeof aiConfig>;
export const defaults = aiConfig.parse({});
// The single model slot actually being called, with the shared (endpoint,
// rate-limit) fields flattened in alongside it.
export type EffectiveAiConfig = Omit<AiConfig, "primary" | "fallback"> &
  ModelParams;
type ModelIdentity = { provider: AiConfig["provider"]; baseUrl: string; model: string };
export function isAlibabaQwen(config: ModelIdentity) {
  return (
    config.provider === "openai-compatible" &&
    new URL(config.baseUrl).hostname.endsWith(".aliyuncs.com") &&
    /^qwen3\.[5-8]-(flash|plus|max)(?:-|$)/.test(config.model)
  );
}
export function isAlibabaDeepSeek(config: ModelIdentity) {
  return (
    config.provider === "openai-compatible" &&
    new URL(config.baseUrl).hostname.endsWith(".aliyuncs.com") &&
    /^deepseek-v4(?:\.\d)?-(flash|pro)(?:-\d{4})?$/.test(config.model)
  );
}
export function isAlibabaThinkingModel(config: ModelIdentity) {
  return isAlibabaQwen(config) || isAlibabaDeepSeek(config);
}
// The model the Worker actually calls: the fallback once the first model's
// free quota is exhausted for this Workspace, otherwise the primary model.
export function effectiveModelConfig(
  config: AiConfig,
  fallbackActive: boolean,
): EffectiveAiConfig {
  const { primary, fallback, ...shared } = config;
  const params = fallbackActive && fallback ? fallback : primary;
  return { ...shared, ...params };
}
// Lease must outlive the model call itself with room for the context fetch,
// validation and publish steps that follow it in the same job.
export const MIN_LEASE_SECONDS = 420;
export const LEASE_BUFFER_SECONDS = 120;
export function leaseSecondsFor(config: { timeoutSeconds: number }) {
  return Math.max(MIN_LEASE_SECONDS, config.timeoutSeconds + LEASE_BUFFER_SECONDS);
}
function validateModelParams(
  config: { provider: AiConfig["provider"]; baseUrl: string },
  params: ModelParams,
) {
  const effective = { ...config, ...params };
  if (
    !isAlibabaThinkingModel(effective) &&
    (params.enable_thinking !== undefined ||
      params.thinking_budget != null ||
      params.max_completion_tokens != null)
  )
    throw new AppError(400, "AI_REASONING_NOT_SUPPORTED");
  if (isAlibabaQwen(effective) && !["none", "default"].includes(params.reasoning))
    throw new AppError(400, "AI_REASONING_NOT_SUPPORTED");
  if (
    isAlibabaDeepSeek(effective) &&
    !["none", "default", "high", "max"].includes(params.reasoning)
  )
    throw new AppError(400, "AI_REASONING_NOT_SUPPORTED");
  if (
    config.provider === "nvidia" &&
    ((params.model.startsWith("deepseek-ai/deepseek-v4-") &&
      params.reasoning === "low") ||
      (params.model === "moonshotai/kimi-k3" && params.reasoning === "none"))
  )
    throw new AppError(400, "AI_REASONING_NOT_SUPPORTED");
}
function validateHost(config: { provider: AiConfig["provider"]; baseUrl: string }) {
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
// Validates the persisted settings record: both model slots (primary always,
// fallback when set) plus the shared endpoint. Called before saving.
export function validateEndpoint(config: AiConfig) {
  if (config.fallback) {
    if (config.fallback.model === config.primary.model)
      throw new AppError(400, "AI_FALLBACK_SAME_MODEL");
    try {
      validateModelParams(config, config.fallback);
    } catch (e) {
      // Name which model failed: primary is validated separately below, so a
      // rejection here is about the second model, not the first.
      if (e instanceof AppError && e.code === "AI_REASONING_NOT_SUPPORTED")
        throw new AppError(400, "AI_FALLBACK_REASONING_NOT_SUPPORTED");
      throw e;
    }
  }
  validateModelParams(config, config.primary);
  validateHost(config);
}
// Validates just the one model slot actually being called, as a defense-in-
// depth check right before the HTTP request goes out.
export function validateEffectiveEndpoint(config: EffectiveAiConfig) {
  validateModelParams(config, config);
  validateHost(config);
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
// A short, sanitized provider error token: only code/type, never message/id
// (those can carry free text). Lets a future unmatched case stay visible in
// diagnostics/logs without ever persisting provider prose.
export type ProviderError = { code?: string; type?: string };
// Untrusted response field: keep only a short enum-like token, never persist
// or log anything else from a provider error body.
function safeProviderToken(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" && /^[\w.\-]{1,64}$/.test(value)
    ? value
    : "unparsed";
}
export class ModelError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public retryAfter: number | null = null,
    public providerError: ProviderError | null = null,
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
  config: EffectiveAiConfig,
  secret: string,
  messages: unknown[],
  signal: AbortSignal,
  beforePoll?: () => Promise<void>,
  observe?: (event: ModelObservation) => void,
) {
  validateEffectiveEndpoint(config);
  let response = await fetch(
    config.baseUrl.replace(/\/$/, "") + "/chat/completions",
    {
      ...modelTransport(config.timeoutSeconds),
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
          ...modelTransport(config.timeoutSeconds),
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
    let providerError: ProviderError | null = null;
    if (
      (response.status === 403 || response.status === 429) &&
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
            providerError = {
              code: safeProviderToken(body.error?.code ?? body.code),
              type: safeProviderToken(body.error?.type ?? body.type),
            };
          } else providerError = { code: "unparsed", type: "unparsed" };
        } catch {
          providerError = { code: "unparsed", type: "unparsed" };
        } finally {
          await reader.cancel().catch(() => {});
        }
      }
    } else await response.body?.cancel();
    // Alibaba's OpenAI-compatible endpoint returns "insufficient_quota" (code
    // and/or type) for the same exhaustion AllocationQuota.FreeTierOnly names
    // on the native API; observed directly against a real exhausted account
    // on 2026-09-14. Only classify at 403 — a 429 with either code is a
    // request/token-rate limit, not exhaustion, and must stay retryable.
    if (
      response.status === 403 &&
      (providerError?.code === "AllocationQuota.FreeTierOnly" ||
        providerError?.code === "insufficient_quota" ||
        providerError?.type === "insufficient_quota")
    )
      throw new ModelError(
        "AI_FREE_QUOTA_EXHAUSTED",
        false,
        null,
        providerError,
      );
    throw new ModelError(
      "AI_HTTP_" + response.status,
      response.status === 202 ||
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
      parseRetryAfter(response.headers.get("retry-after")),
      providerError,
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
