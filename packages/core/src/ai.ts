import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError } from "./db.js";
export const aiConfig = z
  .object({
    enabled: z.boolean().default(false),
    provider: z.enum(["nvidia", "openai-compatible"]).default("nvidia"),
    baseUrl: z.string().url().default("https://integrate.api.nvidia.com/v1"),
    model: z
      .string()
      .min(1)
      .max(160)
      .default("deepseek-ai/deepseek-v4-flash-0731"),
    dailyCalls: z.number().int().min(1).max(1000).default(24),
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
export function validateEndpoint(config: AiConfig) {
  if (
    config.provider === "nvidia" &&
    ((config.model.startsWith("deepseek-ai/deepseek-v4-") &&
      config.reasoning === "low") ||
      (config.model === "moonshotai/kimi-k3" && config.reasoning === "none"))
  )
    throw new AppError(400, "AI_REASONING_NOT_SUPPORTED");
  const url = new URL(config.baseUrl);
  const hosts = (
    process.env.AI_ALLOWED_HOSTS ?? "integrate.api.nvidia.com,api.deepseek.com"
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
    public retryAfter = 60,
  ) {
    super(code);
  }
}
export async function callModel(
  config: AiConfig,
  secret: string,
  messages: unknown[],
  signal: AbortSignal,
) {
  validateEndpoint(config);
  let response = await fetch(
    config.baseUrl.replace(/\/$/, "") + "/chat/completions",
    {
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
        max_tokens: config.maxTokens,
        ...(config.reasoning === "default"
          ? {}
          : { reasoning_effort: config.reasoning }),
      }),
    },
  );
  if (response.status === 202 && config.provider === "nvidia") {
    const headerId = response.headers.get("nvcf-reqid");
    const pending = (await response.json().catch(() => ({}))) as {
      requestId?: string;
    };
    const id = headerId ?? pending.requestId;
    if (!id || !/^[a-f0-9-]{36}$/i.test(id))
      throw new ModelError("AI_PENDING_ID_MISSING");
    for (let poll = 0; poll < 40 && response.status === 202; poll++) {
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
      response = await fetch(
        config.baseUrl.replace(/\/$/, "") + "/status/" + id,
        {
          headers: { authorization: "Bearer " + secret },
          redirect: "error",
          signal,
        },
      );
      if (response.status === 202) await response.body?.cancel();
    }
  }
  if (!response.ok || response.status === 202) {
    await response.body?.cancel();
    throw new ModelError(
      "AI_HTTP_" + response.status,
      response.status === 429 || response.status >= 500,
      Math.min(
        3600,
        Math.max(30, Number(response.headers.get("retry-after")) || 60),
      ),
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
  const choice = data.choices?.[0];
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
  const usage = z
    .object({
      prompt_tokens: z.number().nonnegative().optional(),
      completion_tokens: z.number().nonnegative().optional(),
      total_tokens: z.number().nonnegative().optional(),
    })
    .parse(data.usage ?? {});
  return { output, usage };
}
