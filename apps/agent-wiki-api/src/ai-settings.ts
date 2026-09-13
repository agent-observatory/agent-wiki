import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AppError, tx } from "../../../packages/core/src/db.js";
import {
  aiConfig,
  defaults,
  encryptSecret,
  decryptSecret,
  validateEndpoint,
  callModel,
  ModelError,
  type AiConfig,
} from "../../../packages/core/src/ai.js";
import {
  modelGateKey,
  waitForModelSlot,
  coolDownModel,
} from "../../../packages/core/src/model-gate.js";

type Scoped = <T>(
  r: FastifyRequest,
  fn: (c: PoolClient, ws: string) => Promise<T>,
) => Promise<T>;
type Settings = {
  config: AiConfig;
  encrypted_key?: string | null;
  version: number;
};
const input = z
  .object({
    config: aiConfig,
    apiKey: z.string().max(2000).optional(),
    version: z.number().int().nonnegative(),
  })
  .strict();
function resolveKey(
  row: Settings | undefined,
  config: AiConfig,
  apiKey?: string,
) {
  if (apiKey?.trim()) return encryptSecret(apiKey.trim());
  if (
    row &&
    new URL(row.config.baseUrl).origin === new URL(config.baseUrl).origin
  )
    return row.encrypted_key;
  if (row) throw new AppError(400, "AI_KEY_REQUIRED");
  return null;
}
export function registerAiSettings(
  app: FastifyInstance,
  scoped: Scoped,
  sessionOnly: (r: FastifyRequest) => void,
) {
  const base = "/api/workspaces/:workspaceId/ai-settings";
  app.get(base, (r) => {
    sessionOnly(r);
    return scoped(r, async (c, ws) => {
      const row = (
        await c.query(
          "SELECT config,encrypted_key,version FROM ai_settings WHERE workspace_id=$1",
          [ws],
        )
      ).rows[0] as Settings | undefined;
      const config = aiConfig.parse(row?.config ?? defaults);
      return {
        ...config,
        hasKey: !!row?.encrypted_key,
        version: row?.version ?? 0,
      };
    });
  });
  app.put(base, (r) => {
    sessionOnly(r);
    const body = input.parse(r.body),
      config = body.config;
    validateEndpoint(config);
    return scoped(r, async (c, ws) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        ws + "settings",
      ]);
      const row = (
        await c.query("SELECT * FROM ai_settings WHERE workspace_id=$1", [ws])
      ).rows[0] as Settings | undefined;
      if ((row?.version ?? 0) !== body.version)
        throw new AppError(409, "REVISION_CONFLICT");
      const secret = resolveKey(row, config, body.apiKey);
      if (config.enabled && !secret) throw new AppError(400, "AI_KEY_REQUIRED");
      await c.query(
        "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET config=$2,encrypted_key=$3,version=ai_settings.version+1,updated_at=now()",
        [ws, JSON.stringify(config), secret ?? null],
      );
      return { ok: true };
    });
  });
  app.post(
    base + "/test",
    { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    async (r) => {
      sessionOnly(r);
      const body = input.parse(r.body),
        config = body.config;
      validateEndpoint(config);
      const encrypted = await scoped(r, async (c, ws) => {
        const row = (
          await c.query("SELECT * FROM ai_settings WHERE workspace_id=$1", [ws])
        ).rows[0] as Settings | undefined;
        if ((row?.version ?? 0) !== body.version)
          throw new AppError(409, "REVISION_CONFLICT");
        return resolveKey(row, config, body.apiKey);
      });
      if (!encrypted) throw new AppError(400, "AI_KEY_REQUIRED");
      const secret = decryptSecret(encrypted),
        owner = r.identity!.userId;
      const gateKey = modelGateKey(config.baseUrl, secret),
        signal = AbortSignal.timeout(20000);
      const started = performance.now();
      try {
        await waitForModelSlot(
          owner,
          gateKey,
          signal,
          config.requestsPerMinute,
        );
        const result = await callModel(
          {
            ...config,
            maxTokens: 512,
            ...(config.max_completion_tokens != null
              ? {
                  max_completion_tokens: Math.max(
                    512,
                    (config.thinking_budget ?? 1024) + 512,
                  ),
                }
              : {}),
          },
          secret,
          [
            {
              role: "user",
              content: 'Reply with JSON only: {"message":"Hello"}',
            },
          ],
          signal,
          () =>
            waitForModelSlot(owner, gateKey, signal, config.requestsPerMinute),
        );
        if (
          !z.object({ message: z.literal("Hello") }).safeParse(result.output)
            .success
        )
          throw new AppError(400, "AI_TEST_INVALID_RESPONSE");
        return {
          ok: true,
          message: "Hello",
          durationMs: Math.round(performance.now() - started),
          usage: result.usage,
        };
      } catch (e) {
        if (e instanceof ModelError) {
          if (/^AI_HTTP_(429|5\d\d)$/.test(e.code))
            await tx(owner, null, (c) =>
              coolDownModel(
                c,
                owner,
                gateKey,
                e.retryAfter ?? null,
                config.retryDelaySeconds,
              ),
            );
          throw new AppError(400, e.code);
        }
        if (signal.aborted) throw new AppError(400, "AI_TEST_TIMEOUT");
        if (e instanceof AppError) throw e;
        throw new AppError(400, "AI_CONNECTION_FAILED");
      }
    },
  );
}
