import { pagination, paged } from "./pagination.js";
import { refinementHealth } from "./refinement-health.js";
import { refinementProgress } from "./refinement-progress.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, requireRow } from "../../../packages/core/src/db.js";
import {
  hash,
  mask,
  maskRecord,
  putSource,
} from "../../../packages/core/src/storage.js";
import {
  aiConfig,
  defaults,
  encryptSecret,
  validateEndpoint,
} from "../../../packages/core/src/ai.js";
type Scoped = <T>(
  r: FastifyRequest,
  fn: (c: PoolClient, ws: string) => Promise<T>,
) => Promise<T>;
export function registerAutomation(
  app: FastifyInstance,
  scoped: Scoped,
  sessionOnly: (r: FastifyRequest) => void,
) {
  const base = "/api/workspaces/:workspaceId";
  app.post(
    base + "/collection",
    {
      bodyLimit: 2000000,
      config: {
        rateLimit: {
          max: 600,
          timeWindow: "1 minute",
          keyGenerator: (r: FastifyRequest) => "collection:" + r.ip,
        },
      },
    },
    async (r) => {
      const input = z
        .object({
          machine: z.string().min(1).max(100),
          client: z.enum(["codex", "claude"]),
          sessionId: z.string().min(1).max(200),
          name: z.string().min(1).max(180),
          start: z.number().int().min(0),
          records: z.array(z.string().min(1).max(1000000)).min(1).max(100),
        })
        .strict()
        .parse(r.body);
      if (Buffer.byteLength(input.records.join("\n")) > 1000000)
        throw new AppError(413, "COLLECTION_TOO_LARGE");
      const records = input.records.map((line) => {
        try {
          return JSON.stringify(maskRecord(JSON.parse(line)));
        } catch {
          throw new AppError(400, "INVALID_RECORD");
        }
      });
      const stream = hash(
        JSON.stringify([input.machine, input.client, input.sessionId]),
      );
      return scoped(r, async (c, ws) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          ws + stream,
        ]);
        await c.query(
          "INSERT INTO collection_streams(workspace_id,id,client,session_id,name) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
          [ws, stream, input.client, input.sessionId, mask(input.name)],
        );
        const existing = (
          await c.query(
            "SELECT position,content_hash FROM collection_events WHERE workspace_id=$1 AND stream_id=$2 AND position BETWEEN $3 AND $4",
            [ws, stream, input.start, input.start + records.length - 1],
          )
        ).rows;
        const seen = new Set(
          existing.map((x) => x.position + ":" + x.content_hash),
        );
        const fresh = records
          .map((text, i) => ({
            text,
            position: input.start + i,
            hash: hash(text),
          }))
          .filter((x) => !seen.has(x.position + ":" + x.hash));
        if (!fresh.length) return { accepted: 0, duplicate: records.length };
        const text = fresh
            .map((x) => JSON.stringify(JSON.parse(x.text), null, 2))
            .join("\n"),
          id = randomUUID(),
          job = randomUUID(),
          contentHash = hash(text),
          objectKey = ws + "/" + contentHash + ".txt.gz";
        await putSource(objectKey, text);
        await c.query(
          "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,$3,'conversation',$4,$5,$5,$6,$7,$8,true)",
          [
            id,
            ws,
            mask(input.name),
            input.client + ":" + mask(input.sessionId),
            contentHash,
            objectKey,
            text.split("\n").length,
            "collect-" + id,
          ],
        );
        for (const record of fresh)
          await c.query(
            "INSERT INTO collection_events(workspace_id,stream_id,position,content_hash,source_id) VALUES($1,$2,$3,$4,$5)",
            [ws, stream, record.position, record.hash, id],
          );
        await c.query(
          "UPDATE collection_streams SET last_position=GREATEST(last_position,$3),updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [ws, stream, input.start + records.length - 1],
        );
        await c.query(
          "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
          [job, ws, id],
        );
        return {
          accepted: fresh.length,
          duplicate: records.length - fresh.length,
          sourceId: id,
          jobId: job,
        };
      });
    },
  );
  app.get(base + "/ai-settings", (r) => {
    sessionOnly(r);
    return scoped(r, async (c, ws) => {
      const row = (
        await c.query(
          "SELECT config,encrypted_key IS NOT NULL AS has_key,version FROM ai_settings WHERE workspace_id=$1",
          [ws],
        )
      ).rows[0];
      return {
        ...aiConfig.parse(row?.config ?? defaults),
        hasKey: row?.has_key ?? false,
        version: row?.version ?? 0,
      };
    });
  });
  app.put(base + "/ai-settings", (r) => {
    sessionOnly(r);
    const body = z
      .object({
        config: aiConfig,
        apiKey: z.string().max(2000).optional(),
        version: z.number().int().nonnegative(),
      })
      .strict()
      .parse(r.body);
    validateEndpoint(body.config);
    return scoped(r, async (c, ws) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        ws + "settings",
      ]);
      const old = (
        await c.query("SELECT * FROM ai_settings WHERE workspace_id=$1", [ws])
      ).rows[0];
      if ((old?.version ?? 0) !== body.version)
        throw new AppError(409, "REVISION_CONFLICT");
      if (
        old &&
        new URL(old.config.baseUrl).origin !==
          new URL(body.config.baseUrl).origin &&
        !body.apiKey?.trim()
      )
        throw new AppError(400, "AI_KEY_REQUIRED");
      const secret = body.apiKey?.trim()
        ? encryptSecret(body.apiKey.trim())
        : old?.encrypted_key;
      if (body.config.enabled && !secret)
        throw new AppError(400, "AI_KEY_REQUIRED");
      await c.query(
        "INSERT INTO ai_settings(workspace_id,config,encrypted_key) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET config=$2,encrypted_key=$3,version=ai_settings.version+1,updated_at=now()",
        [ws, JSON.stringify(body.config), secret ?? null],
      );
      return { ok: true };
    });
  });
  app.patch(base + "/ai-settings/enabled", (r) => {
    sessionOnly(r);
    const body = z
      .object({ enabled: z.boolean(), version: z.number().int().nonnegative() })
      .strict()
      .parse(r.body);
    return scoped(r, async (c, ws) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        ws + "settings",
      ]);
      const old = (
        await c.query("SELECT * FROM ai_settings WHERE workspace_id=$1", [ws])
      ).rows[0];
      const version = old?.version ?? 0;
      if (version !== body.version)
        throw new AppError(409, "REVISION_CONFLICT");
      if (body.enabled && !old?.encrypted_key)
        throw new AppError(400, "AI_KEY_REQUIRED");
      if ((old?.config.enabled ?? false) === body.enabled)
        return { enabled: body.enabled, version };
      const row = (
        await c.query(
          "UPDATE ai_settings SET config=jsonb_set(config,'{enabled}',$2::jsonb),version=version+1,updated_at=now() WHERE workspace_id=$1 RETURNING version",
          [ws, JSON.stringify(body.enabled)],
        )
      ).rows[0];
      return { enabled: body.enabled, version: row.version };
    });
  });
  app.get(base + "/refinements", (r) => {
    sessionOnly(r);
    return scoped(r, async (c, ws) => {
      const today = (
        await c.query(
          "SELECT count(*)::int AS calls,COALESCE(sum((usage->>'total_tokens')::bigint),0)::text AS tokens FROM refinement_runs WHERE workspace_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
          [ws],
        )
      ).rows[0];
      const pages = Object.fromEntries(
        ["jobs", "runs", "uploads", "streams"].map((key) => [
          key,
          pagination(r.query, key + "Page"),
        ]),
      );
      const result = {
        progress: await refinementProgress(c, ws, today.calls),
        health: await refinementHealth(c, ws),
        items: (
          await c.query(
            "SELECT j.*,s.name FROM refinement_jobs j JOIN sources s ON s.id=j.source_id AND s.workspace_id=j.workspace_id WHERE j.workspace_id=$1 AND s.deleted_at IS NULL ORDER BY CASE WHEN j.status='running' THEN 0 WHEN j.status='pending' AND j.error_code IS NOT NULL THEN 1 WHEN j.status='failed' THEN 2 WHEN j.status='pending' THEN 3 ELSE 4 END,j.created_at,j.id LIMIT $2 OFFSET $3",
            [ws, pages.jobs.size + 1, pages.jobs.offset],
          )
        ).rows.map(({ output, chunk_plan, chunk_results, ...job }) => job),
        runs: (
          await c.query(
            "SELECT id,job_id,settings,prompt_version,chunk_index,usage,status,error_code,diagnostics,created_at,finished_at FROM refinement_runs WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3",
            [ws, pages.runs.size + 1, pages.runs.offset],
          )
        ).rows,
        today,
        uploads: (
          await c.query(
            "SELECT id,manifest->>'name' AS name,status,compressed_bytes,result,error_code,updated_at FROM collection_uploads WHERE workspace_id=$1 ORDER BY updated_at DESC,id DESC LIMIT $2 OFFSET $3",
            [ws, pages.uploads.size + 1, pages.uploads.offset],
          )
        ).rows,
        streams: (
          await c.query(
            "SELECT s.id,s.client,s.name,s.last_position,s.updated_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('machine',o.machine,'bytes',o.byte_end,'records',o.record_end)) FROM collection_origins o WHERE o.workspace_id=s.workspace_id AND o.stream_id=s.id),'[]'::jsonb) AS origins FROM collection_streams s WHERE s.workspace_id=$1 ORDER BY s.updated_at DESC,s.id DESC LIMIT $2 OFFSET $3",
            [ws, pages.streams.size + 1, pages.streams.offset],
          )
        ).rows,
      };
      const pageInfo: Record<string, unknown> = {};
      for (const [field, name] of [
        ["items", "jobs"],
        ["runs", "runs"],
        ["uploads", "uploads"],
        ["streams", "streams"],
      ] as const) {
        const view = paged<any>(result[field], pages[name]);
        result[field] = view.items;
        pageInfo[name] = view.pagination;
      }
      return { ...result, pagination: pageInfo };
    });
  });
  app.post(base + "/refinements/:id/retry", (r) => {
    sessionOnly(r);
    return scoped(r, async (c, ws) => {
      const id = z
        .string()
        .uuid()
        .parse((r.params as any).id);
      requireRow(
        (
          await c.query(
            "UPDATE refinement_jobs SET status='pending',attempts=0,available_at=now(),error_code=NULL,output=NULL,run_id=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status='failed' RETURNING id",
            [ws, id],
          )
        ).rows[0],
      );
      return { ok: true };
    });
  });
}
