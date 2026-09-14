import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, requireRow } from "../../../packages/core/src/db.js";
import {
  hash,
  mask,
  putSource,
  getSource,
} from "../../../packages/core/src/storage.js";
import {
  sourceInfo,
  collectionSummary,
  collectionHistory,
} from "./source-history.js";
import { pagination, paged } from "./pagination.js";
import {
  uuid,
  small,
  keySchema,
  canonical,
  conflict,
} from "./publication-schema.js";
type Scoped = <T>(
  req: FastifyRequest,
  run: (c: PoolClient, ws: string) => Promise<T>,
) => Promise<T>;
const params = (r: FastifyRequest) => r.params as Record<string, string>;
export function registerSourceRecords(
  app: FastifyInstance,
  scoped: Scoped,
  sessionOnly: (r: FastifyRequest) => void,
) {
  const base = "/api/workspaces/:workspaceId";
  app.get(base + "/source-records", (r) =>
    scoped(r, async (c, ws) => {
      const page = pagination(r.query);
      return paged(
        (
          await c.query(
            "SELECT id,name,kind,origin,revision,line_count,content_hash,masked,created_at FROM sources WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3",
            [ws, page.size + 1, page.offset],
          )
        ).rows,
        page,
      );
    }),
  );
  app.get(base + "/source-sessions", (r) =>
    scoped(r, async (c, ws) => {
      const page = pagination(r.query);
      return paged(
        (
          await c.query(
            `SELECT (array_agg(id ORDER BY created_at,id))[1] AS id,
      (array_agg(name ORDER BY created_at DESC,id DESC))[1] AS name,
      max(created_at) AS created_at, sum(line_count)::int AS line_count,
      bool_or(masked) AS masked, count(*)::int AS records,
      sum((SELECT count(*) FROM collection_events e WHERE e.workspace_id=s.workspace_id AND e.source_id=s.id))::int AS event_count
      FROM sources s WHERE workspace_id=$1 AND deleted_at IS NULL
      GROUP BY CASE WHEN kind='conversation' AND origin<>'' THEN origin ELSE id::text END
      ORDER BY max(created_at) DESC,(array_agg(id ORDER BY created_at,id))[1] DESC LIMIT $2 OFFSET $3`,
            [ws, page.size + 1, page.offset],
          )
        ).rows,
        page,
      );
    }),
  );
  app.get(base + "/source-records/:id/info", (r) =>
    scoped(r, async (c, ws) => {
      const source = await sourceInfo(c, ws, uuid.parse(params(r).id));
      return { ...source, collection: await collectionSummary(c, ws, source) };
    }),
  );
  app.get(base + "/source-records/:id/collection-history", (r) =>
    scoped(r, async (c, ws) => {
      const source = await sourceInfo(c, ws, uuid.parse(params(r).id));
      return collectionHistory(
        c,
        ws,
        source,
        pagination(r.query, "historyPage"),
      );
    }),
  );
  app.get(base + "/source-records/:id/session-text", (r) =>
    scoped(r, async (c, ws) => {
      const source = requireRow(
        (
          await c.query(
            "SELECT id,kind,origin FROM sources WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
            [ws, uuid.parse(params(r).id)],
          )
        ).rows[0],
      );
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .default(1)
        .parse((r.query as any).page);
      const rows = (
        await c.query(
          `SELECT id,object_key,content_hash,metadata FROM sources WHERE workspace_id=$1 AND deleted_at IS NULL AND
      (($2='conversation' AND $3<>'' AND kind='conversation' AND origin=$3) OR id=$4) ORDER BY created_at,CASE WHEN idempotency_key ~ '^upload-.*-[0-9]+$' THEN substring(idempotency_key from '([0-9]+)$')::int ELSE 0 END,id LIMIT 2 OFFSET $5`,
          [ws, source.kind, source.origin, source.id, page - 1],
        )
      ).rows;
      const row = requireRow(rows[0]);
      const text = await getSource(row.object_key);
      if (hash(text) !== row.content_hash)
        throw new AppError(500, "SOURCE_HASH_MISMATCH");
      return {
        id: row.id,
        text,
        projected: !!row.metadata?.projection,
        page,
        hasNext: rows.length > 1,
      };
    }),
  );
  app.post(base + "/source-records", async (r) => {
    const input = z
      .object({
        name: small,
        kind: z
          .enum(["conversation", "document", "code", "note"])
          .default("document"),
        origin: z.string().max(2000).default(""),
        text: z
          .string()
          .min(1)
          .max(100000)
          .refine((t) => Buffer.byteLength(t) <= 100000),
      })
      .strict()
      .parse(r.body);
    const key = keySchema.parse(r.headers["idempotency-key"]);
    const text = mask(input.text.replace(/\r\n?/g, "\n"));
    const fingerprint = hash(canonical({ ...input, text }));
    const existing = await scoped(
      r,
      async (c, ws) =>
        (
          await c.query(
            "SELECT * FROM sources WHERE workspace_id=$1 AND idempotency_key=$2",
            [ws, key],
          )
        ).rows[0],
    );
    const response = (s: any) => {
      if (s.payload_hash !== fingerprint) conflict("IDEMPOTENCY_CONFLICT");
      if (s.deleted_at) conflict("SOURCE_DELETED");
      return {
        id: s.id,
        revision: 1,
        contentHash: s.content_hash,
        lineCount: s.line_count,
        masked: s.masked,
        text,
      };
    };
    if (existing) return response(existing);
    const ws = uuid.parse(params(r).workspaceId);
    const objectKey = ws + "/" + hash(text) + ".txt.gz";
    await putSource(objectKey, text);
    return scoped(r, async (c, w) => {
      await c.query(
        "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(workspace_id,idempotency_key) DO NOTHING",
        [
          randomUUID(),
          w,
          input.name,
          input.kind,
          mask(input.origin),
          hash(text),
          fingerprint,
          objectKey,
          text.split("\n").length,
          key,
          text !== input.text,
        ],
      );
      return response(
        requireRow(
          (
            await c.query(
              "SELECT * FROM sources WHERE workspace_id=$1 AND idempotency_key=$2",
              [w, key],
            )
          ).rows[0],
        ),
      );
    });
  });
  app.get(base + "/source-records/:id/revisions/:revision", (r) =>
    scoped(r, async (c, ws) => {
      if (params(r).revision !== "1") throw new AppError(404, "NOT_FOUND");
      const source = requireRow(
        (
          await c.query(
            "SELECT * FROM sources WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
            [ws, uuid.parse(params(r).id)],
          )
        ).rows[0],
      );
      const query = z
        .object({
          start: z.coerce.number().int().positive().default(1),
          end: z.coerce.number().int().positive().optional(),
        })
        .parse(r.query);
      const end = query.end ?? source.line_count;
      if (query.start > end || end > source.line_count)
        throw new AppError(400, "INVALID_LINE_RANGE");
      const text = await getSource(source.object_key);
      if (hash(text) !== source.content_hash)
        throw new AppError(500, "SOURCE_HASH_MISMATCH");
      return {
        ...source,
        object_key: undefined,
        payload_hash: undefined,
        idempotency_key: undefined,
        text: text
          .split("\n")
          .slice(query.start - 1, end)
          .join("\n"),
        start: query.start,
        end,
      };
    }),
  );
  app.delete(base + "/source-records/:id", (r) => {
    sessionOnly(r);
    return scoped(r, async (c, ws) => {
      requireRow(
        (
          await c.query(
            "UPDATE sources SET deleted_at=now() WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id",
            [ws, uuid.parse(params(r).id)],
          )
        ).rows[0],
      );
      return { ok: true };
    });
  });
}
