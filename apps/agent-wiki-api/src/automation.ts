import { reprocessPlan, enqueueReprocess } from "./curation-reprocess.js";
import { refreshWikiPages } from "./wiki-pages.js";
import { backfillEvidenceTimes } from "./evidence-time.js";
import { publish } from "./knowledge.js";
import { registerAiSettings } from "./ai-settings.js";
import { modelCallPredicate } from "../../../packages/core/src/model-call-history.js";
import { queueCuration, rebuildCuration } from "./curation-rebuild.js";
import {
  refinementSessions,
  retryRefinementSession,
  refinementSessionJobs,
} from "./refinement-sessions.js";
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
import { aiConfig, defaults } from "../../../packages/core/src/ai.js";
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
  app.get(base + "/curation/reprocess/plan/:runId", (r) => {
    sessionOnly(r);
    return scoped(r, (c, ws) =>
      reprocessPlan(
        c,
        ws,
        z
          .string()
          .uuid()
          .parse((r.params as any).runId),
      ),
    );
  });
  app.post(base + "/curation/reprocess", (r) => {
    sessionOnly(r);
    const body = z
      .object({
        requestId: z.string().uuid(),
        runId: z.string().uuid(),
        fingerprint: z.string().length(64),
        mode: z.enum(["analyze", "revalidate"]).default("analyze"),
        reason: z.string().min(1).max(1000),
      })
      .strict()
      .parse(r.body);
    return scoped(r, (c, ws) => enqueueReprocess(c, ws, body));
  });
  app.get(base + "/curation/reprocess/:id", (r) => {
    sessionOnly(r);
    return scoped(r, async (c, ws) =>
      requireRow(
        (
          await c.query(
            "SELECT * FROM curation_reprocesses WHERE workspace_id=$1 AND id=$2",
            [
              ws,
              z
                .string()
                .uuid()
                .parse((r.params as any).id),
            ],
          )
        ).rows[0],
      ),
    );
  });
  app.post(base + "/curation/reprocess/:id/apply", (r) => {
    sessionOnly(r);
    const body = z
      .object({
        fingerprint: z.string().length(64),
        publication: z.record(z.string(), z.unknown()),
      })
      .strict()
      .parse(r.body);
    return scoped(r, async (c, ws) => {
      const request = requireRow(
        (
          await c.query(
            "SELECT * FROM curation_reprocesses WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
            [
              ws,
              z
                .string()
                .uuid()
                .parse((r.params as any).id),
            ],
          )
        ).rows[0],
      );
      const publicationHash = hash(JSON.stringify(body.publication));
      if (request.status === "applied") {
        if (request.candidate.publicationHash !== publicationHash)
          throw new AppError(409, "IDEMPOTENCY_CONFLICT");
        return request.candidate.applied;
      }
      if (request.status !== "ready")
        throw new AppError(409, "REPROCESS_NOT_READY");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        ws,
      ]);
      const current = await reprocessPlan(c, ws, request.original_run_id);
      if (current.fingerprint !== body.fingerprint)
        throw new AppError(409, "REPROCESS_PLAN_CHANGED");
      const changes = z
        .array(
          z
            .object({
              articleId: z.string().uuid().nullable().optional(),
              baseRevision: z.number().int().nullable().optional(),
              claims: z.array(z.object({ anchor: z.string() }).passthrough()),
            })
            .passthrough(),
        )
        .parse(body.publication.changes);
      // A correction retains every old anchor, including retracted history.
      for (const change of changes)
        if (change.articleId) {
          const old = await c.query(
            "SELECT cl.anchor,a.revision FROM claims cl JOIN articles a ON a.workspace_id=cl.workspace_id AND a.id=cl.article_id AND a.revision=cl.revision WHERE cl.workspace_id=$1 AND cl.article_id=$2 AND a.deleted_at IS NULL",
            [ws, change.articleId],
          );
          if (old.rows.some((row) => row.revision !== change.baseRevision))
            throw new AppError(409, "REVISION_CONFLICT");
          if (
            old.rows.some(
              (row) =>
                !change.claims.some((claim) => claim.anchor === row.anchor),
            )
          )
            throw new AppError(400, "REPROCESS_PRESERVE_CLAIMS");
        }
      // An agent supplies an explicitly reviewed publication, including fixed
      // article/baseRevision for corrections. Candidate omission never deletes.
      const result = await publish(
        c,
        ws,
        {
          ...body.publication,
          reason:
            "분석 정정 · 재작업 " +
            request.id +
            " · " +
            String(body.publication.reason ?? ""),
        },
        { userId: r.identity!.userId, scope: "manage" },
      );
      await c.query(
        "UPDATE curation_reprocesses SET status='applied',candidate=candidate||$3::jsonb,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [
          ws,
          request.id,
          JSON.stringify({
            applied: result,
            publicationHash,
          }),
        ],
      );
      return result;
    });
  });
  app.post(base + "/wiki-pages/reassemble", (r) => {
    sessionOnly(r);
    return scoped(r, async (c, ws) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        ws,
      ]);
      const sources = await backfillEvidenceTimes(c, ws);
      await refreshWikiPages(c, ws);
      return {
        modelCalls: 0,
        sources,
        rewoundCuration: false,
        pages: (
          await c.query(
            "SELECT id,title,revision FROM wiki_pages WHERE workspace_id=$1 ORDER BY topic_key",
            [ws],
          )
        ).rows,
      };
    });
  });
  registerAiSettings(app, scoped, sessionOnly);
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
          "UPDATE ai_settings SET config=jsonb_set(config,'{enabled}',$2::jsonb),stopped_reason=NULL,stopped_at=NULL,version=version+1,updated_at=now() WHERE workspace_id=$1 RETURNING version",
          [ws, JSON.stringify(body.enabled)],
        )
      ).rows[0];
      return { enabled: body.enabled, version: row.version };
    });
  });
  app.post(base + "/curation/queue", (r) => {
    sessionOnly(r);
    const body = z
      .object({ sourceIds: z.array(z.string().uuid()).max(5000).optional() })
      .strict()
      .parse(r.body ?? {});
    return scoped(r, (c, ws) => queueCuration(c, ws, body.sourceIds));
  });
  app.post(base + "/curation/rebuild", (r) => {
    sessionOnly(r);
    const body = z
      .object({
        requestId: z.string().uuid(),
        sourceIds: z.array(z.string().uuid()).max(5000).optional(),
      })
      .strict()
      .parse(r.body);
    return scoped(r, (c, ws) =>
      rebuildCuration(c, ws, body.requestId, body.sourceIds),
    );
  });
  app.get(base + "/refinement-sessions", (r) => {
    sessionOnly(r);
    return scoped(r, (c, ws) => refinementSessions(c, ws, r.query));
  });
  app.post(base + "/refinement-sessions/:id/retry", (r) => {
    sessionOnly(r);
    return scoped(r, (c, ws) =>
      retryRefinementSession(
        c,
        ws,
        z
          .string()
          .uuid()
          .parse((r.params as any).id),
      ),
    );
  });
  app.get(base + "/refinement-sessions/:id/jobs", (r) => {
    sessionOnly(r);
    return scoped(r, (c, ws) =>
      refinementSessionJobs(
        c,
        ws,
        z
          .string()
          .uuid()
          .parse((r.params as any).id),
        r.query,
      ),
    );
  });
  app.get(base + "/refinements", (r) => {
    sessionOnly(r);
    return scoped(r, async (c, ws) => {
      const today = (
        await c.query(
          `SELECT count(*)::int AS calls,COALESCE(sum((usage->>'total_tokens')::bigint),0)::text AS tokens FROM refinement_runs WHERE workspace_id=$1 AND ${modelCallPredicate} AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
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
        ).rows.map(
          ({ output, chunk_plan, chunk_results, input_sources, ...job }) => job,
        ),
        runs: (
          await c.query(
            `SELECT id,job_id,settings,prompt_version,chunk_index,usage,status,error_code,diagnostics,created_at,finished_at FROM refinement_runs WHERE workspace_id=$1 AND ${modelCallPredicate} ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
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
    const { reuseOutput } = z
      .object({ reuseOutput: z.boolean().default(false) })
      .strict()
      .parse(r.body ?? {});
    return scoped(r, async (c, ws) => {
      const id = z
        .string()
        .uuid()
        .parse((r.params as any).id);
      requireRow(
        (
          await c.query(
            "UPDATE refinement_jobs SET status='pending',attempts=0,available_at=now(),error_code=NULL,output=CASE WHEN $3 THEN output ELSE NULL END,run_id=CASE WHEN $3 THEN run_id ELSE NULL END,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status='failed' AND (NOT $3 OR output IS NOT NULL) RETURNING id",
            [ws, id, reuseOutput],
          )
        ).rows[0],
      );
      return { ok: true };
    });
  });
}
