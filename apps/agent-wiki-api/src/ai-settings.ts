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
type Mode = "free" | "byok";
type Profile = { config: AiConfig; encryptedKey?: string | null };
type Settings = {
  config: AiConfig;
  encrypted_key?: string | null;
  profiles?: Partial<Record<Mode, Profile>>;
  version: number;
};
const modeOf = (config: AiConfig): Mode =>
  config.mode ?? (config.provider === "nvidia" ? "free" : "byok");
function profilesOf(row?: Settings) {
  const profiles = { ...row?.profiles };
  if (row)
    profiles[modeOf(row.config)] = {
      config: row.config,
      encryptedKey: row.encrypted_key,
    };
  return profiles;
}
function normalize(config: AiConfig): AiConfig {
  return config.mode === "free"
    ? {
        ...config,
        provider: defaults.provider,
        model: defaults.model,
        baseUrl: defaults.baseUrl,
        reasoning: defaults.reasoning,
      }
    : config;
}
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
  const profile = profilesOf(row)[modeOf(config)];
  // Never reuse a credential at a different destination, including mode switches.
  if (
    profile &&
    new URL(profile.config.baseUrl).origin === new URL(config.baseUrl).origin
  )
    return profile.encryptedKey;
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
          "SELECT config,encrypted_key,profiles,version FROM ai_settings WHERE workspace_id=$1",
          [ws],
        )
      ).rows[0] as Settings | undefined;
      const config = aiConfig.parse(row?.config ?? defaults);
      const profiles = Object.fromEntries(
        Object.entries(profilesOf(row)).map(([mode, p]) => [
          mode,
          {
            config: { ...aiConfig.parse(p.config), mode },
            hasKey: !!p.encryptedKey,
          },
        ]),
      );
      return {
        ...config,
        mode: modeOf(config),
        hasKey: !!row?.encrypted_key,
        version: row?.version ?? 0,
        profiles,
        freePreset: {
          provider: defaults.provider,
          model: defaults.model,
          baseUrl: defaults.baseUrl,
          reasoning: defaults.reasoning,
        },
      };
    });
  });
  app.put(base, (r) => {
    sessionOnly(r);
    const body = input.parse(r.body),
      config = normalize(body.config);
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
      const profiles = profilesOf(row);
      profiles[modeOf(config)] = { config, encryptedKey: secret };
      await c.query(
        "INSERT INTO ai_settings(workspace_id,config,encrypted_key,profiles) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id) DO UPDATE SET config=$2,encrypted_key=$3,profiles=$4,version=ai_settings.version+1,updated_at=now()",
        [ws, JSON.stringify(config), secret ?? null, JSON.stringify(profiles)],
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
        config = normalize(body.config);
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
        await waitForModelSlot(owner, gateKey, signal);
        const result = await callModel(
          { ...config, maxTokens: 512 },
          secret,
          [
            {
              role: "user",
              content: 'Reply with JSON only: {"message":"Hello"}',
            },
          ],
          signal,
          () => waitForModelSlot(owner, gateKey, signal),
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
              coolDownModel(c, owner, gateKey, e.retryAfter ?? null),
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
