import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, requireRow } from "../../../packages/core/src/db.js";
import {
  hash,
  createUploadGrant,
  revokeUploadGrant,
  getBlob,
} from "../../../packages/core/src/storage.js";
type Scoped = <T>(
  r: FastifyRequest,
  fn: (c: PoolClient, ws: string) => Promise<T>,
) => Promise<T>;
const hex = z.string().regex(/^[a-f0-9]{64}$/),
  identity = z.object({
    machine: z.string().min(1).max(100),
    fileId: hex,
    generation: z.string().uuid(),
    client: z.enum(["codex", "claude"]),
    sessionId: z.string().min(1).max(200),
  });
const part = z
  .object({
    hash: hex,
    compressedHash: hex,
    bytes: z.number().int().min(1).max(4194304),
    compressedBytes: z.number().int().min(1).max(5242880),
  })
  .strict();
const schema = identity
  .extend({
    name: z.string().min(1).max(180),
    start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    end: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    recordStart: z.number().int().nonnegative(),
    recordEnd: z.number().int().positive(),
    prefixHash: hex,
    maskVersion: z.literal("stream-mask-1"),
    codec: z.literal("zstd"),
    parts: z.array(part).min(1).max(128),
  })
  .strict();
const ids = (v: z.infer<typeof identity>) => ({
  stream: hash(JSON.stringify([v.client, v.sessionId])),
  origin: hash(
    JSON.stringify([v.client, v.sessionId, v.machine, v.fileId, v.generation]),
  ),
});
export function registerUploads(app: FastifyInstance, scoped: Scoped) {
  const base = "/api/workspaces/:workspaceId/collection";
  const options = {
    config: {
      rateLimit: {
        max: 600,
        timeWindow: "1 minute",
        keyGenerator: (r: FastifyRequest) => "collection:" + r.ip,
      },
    },
  };
  app.post(base + "/cursor", options, (r) => {
    const v = identity.strict().parse(r.body),
      { stream, origin } = ids(v);
    return scoped(r, async (c, ws) => ({
      ...((
        await c.query(
          'SELECT byte_end AS "end",record_end AS "recordEnd",prefix_hash AS "prefixHash" FROM collection_origins WHERE workspace_id=$1 AND stream_id=$2 AND id=$3',
          [ws, stream, origin],
        )
      ).rows[0] ?? { end: 0, recordEnd: 0, prefixHash: hash("") }),
    }));
  });
  app.post(base + "/uploads", options, (r) => {
    const v = schema.parse(r.body);
    if (v.end <= v.start || v.recordEnd <= v.recordStart)
      throw new AppError(400, "INVALID_RANGE");
    const { stream, origin } = ids(v),
      fingerprint = hash(JSON.stringify(v));
    return scoped(r, async (c, ws) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        ws + "uploads",
      ]);
      const old = (
        await c.query(
          "SELECT id,status,result FROM collection_uploads WHERE workspace_id=$1 AND fingerprint=$2",
          [ws, fingerprint],
        )
      ).rows[0];
      if (old) return old;
      const bytes = v.parts.reduce((s, p) => s + p.compressedBytes, 0);
      const used = (
        await c.query(
          "SELECT COALESCE(sum(compressed_bytes),0)::bigint AS bytes,count(*) FILTER (WHERE status IN ('uploading','queued','verifying'))::int AS active FROM collection_uploads WHERE workspace_id=$1 AND status<>'expired'",
          [ws],
        )
      ).rows[0];
      if (
        Number(used.bytes) + bytes >
          Number(process.env.SOURCE_UPLOAD_BUDGET_BYTES ?? 1073741824) ||
        used.active >= 8
      )
        throw new AppError(429, "UPLOAD_BUDGET_EXCEEDED");
      await c.query(
        "INSERT INTO collection_streams(workspace_id,id,client,session_id,name) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [ws, stream, v.client, v.sessionId, v.name],
      );
      await c.query(
        "INSERT INTO collection_origins(workspace_id,stream_id,id,machine,file_id,generation) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
        [ws, stream, origin, v.machine, v.fileId, v.generation],
      );
      const cursor = (
        await c.query(
          "SELECT byte_end,record_end FROM collection_origins WHERE workspace_id=$1 AND id=$2",
          [ws, origin],
        )
      ).rows[0];
      if (
        Number(cursor.byte_end) !== v.start ||
        cursor.record_end !== v.recordStart
      )
        throw new AppError(409, "CURSOR_CHANGED");
      const id = randomUUID();
      await c.query(
        "INSERT INTO collection_uploads(id,workspace_id,stream_id,origin_id,fingerprint,manifest,compressed_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, ws, stream, origin, fingerprint, JSON.stringify(v), bytes],
      );
      return { id, status: "uploading" };
    });
  });
  app.post(base + "/uploads/:id/parts/:part", options, (r) =>
    scoped(r, async (c, ws) => {
      const { id, part: index } = z
        .object({
          id: z.string().uuid(),
          part: z.coerce.number().int().min(0).max(127),
        })
        .parse(r.params);
      const row = requireRow(
        (
          await c.query(
            "SELECT * FROM collection_uploads WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
            [ws, id],
          )
        ).rows[0],
      );
      if (row.status !== "uploading" || new Date(row.expires_at) < new Date())
        throw new AppError(409, "UPLOAD_CLOSED");
      if (!row.manifest.parts[index]) throw new AppError(400, "INVALID_PART");
      const prior = row.grants?.[index];
      if (prior) await revokeUploadGrant(prior);
      const grant = await createUploadGrant(`staging/${ws}/${id}/${index}.zst`);
      await c.query(
        "UPDATE collection_uploads SET grants=jsonb_set(grants,ARRAY[$3::text],to_jsonb($4::text)),updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [ws, id, String(index), grant.id],
      );
      return { url: grant.url, expiresAt: grant.expiresAt };
    }),
  );
  app.post(base + "/uploads/:id/complete", options, (r) =>
    scoped(r, async (c, ws) => {
      const id = z
        .string()
        .uuid()
        .parse((r.params as any).id);
      const row = requireRow(
        (
          await c.query(
            "SELECT * FROM collection_uploads WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
            [ws, id],
          )
        ).rows[0],
      );
      if (row.status === "uploading") {
        if (new Date(row.expires_at) < new Date())
          throw new AppError(409, "UPLOAD_EXPIRED");
        await c.query(
          "UPDATE collection_uploads SET status='queued',updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [ws, id],
        );
      }
      return {
        id,
        status: row.status === "uploading" ? "queued" : row.status,
        result: row.result,
      };
    }),
  );
  app.get(base + "/uploads/:id/raw", options, (r) =>
    scoped(r, async (c, ws) => {
      const id = z
          .string()
          .uuid()
          .parse((r.params as any).id),
        row = requireRow(
          (
            await c.query(
              "SELECT manifest FROM collection_uploads WHERE workspace_id=$1 AND id=$2 AND status='completed'",
              [ws, id],
            )
          ).rows[0],
        );
      return {
        id,
        codec: "zstd",
        maskVersion: row.manifest.maskVersion,
        originalRange: [row.manifest.start, row.manifest.end],
        recordRange: [row.manifest.recordStart, row.manifest.recordEnd],
        parts: row.manifest.parts.map((p: any, i: number) => ({
          ...p,
          download: `/api/workspaces/${ws}/collection/uploads/${id}/raw/${i}`,
        })),
      };
    }),
  );
  app.get(base + "/uploads/:id/raw/:part", options, async (r, reply) => {
    const body = await scoped(r, async (c, ws) => {
      const { id, part: index } = z
          .object({
            id: z.string().uuid(),
            part: z.coerce.number().int().min(0).max(127),
          })
          .parse(r.params),
        row = requireRow(
          (
            await c.query(
              "SELECT manifest FROM collection_uploads WHERE workspace_id=$1 AND id=$2 AND status='completed'",
              [ws, id],
            )
          ).rows[0],
        );
      const p = row.manifest.parts[index];
      if (!p) throw new AppError(404, "NOT_FOUND");
      const body = await getBlob(
        `raw/${ws}/${id}/${index}.zst`,
        p.compressedBytes,
      );
      if (hash(body) !== p.compressedHash)
        throw new AppError(500, "SOURCE_HASH_MISMATCH");
      return body;
    });
    return reply
      .header("content-type", "application/zstd")
      .header("content-disposition", 'attachment; filename="source-part.zst"')
      .send(body);
  });
  app.get(base + "/uploads/:id", options, (r) =>
    scoped(r, async (c, ws) =>
      requireRow(
        (
          await c.query(
            "SELECT id,status,error_code,result,created_at,updated_at FROM collection_uploads WHERE workspace_id=$1 AND id=$2",
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
    ),
  );
}
