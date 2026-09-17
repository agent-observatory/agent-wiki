import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireRow } from "../../../packages/core/src/db.js";
import { registerQuery } from "./query.js";
import { registerSourceRecords } from "./source-records.js";
import {
  refreshWikiPages,
  listWikiPages,
  wikiPageDetail,
} from "./wiki-pages.js";
import {
  reviewComparison,
  confirmReview,
  pendingReviews,
} from "./knowledge-review.js";
import { pagination, paged } from "./pagination.js";
import { detail, search } from "./article-detail.js";
import { context } from "./knowledge-context.js";
import { publish } from "./knowledge-publish.js";
import { rejectClaimRelation } from "./claim-relation-reject.js";
import { addClaimRelation } from "./claim-relation-add.js";
import { conflictsReview } from "./review-conflicts.js";
import {
  triggerConsolidation,
  triggerAllConsolidations,
  consolidationStatus,
  consolidationPlan,
  topicKeySchema,
} from "./consolidation-control.js";
import { uuid, keySchema, conflict } from "./publication-schema.js";
import {
  aliasInput,
  addSubjectAlias,
  listSubjectAliases,
  removeSubjectAlias,
  subjectSplitCandidates,
} from "./subject-aliases.js";
// Public surface used by the Worker, automation and tests. Keep these stable.
export { publish } from "./knowledge-publish.js";
export { changeInput, MAX_PUBLICATION_CHANGES } from "./publication-schema.js";
export { excerpt } from "./knowledge-excerpt.js";
type Scoped = <T>(
  req: FastifyRequest,
  run: (c: PoolClient, ws: string) => Promise<T>,
) => Promise<T>;
const params = (r: FastifyRequest) => r.params as Record<string, string>;
export function registerKnowledge(
  app: FastifyInstance,
  scoped: Scoped,
  sessionOnly: (r: FastifyRequest) => void,
  appUrl: string,
) {
  const base = "/api/workspaces/:workspaceId";
  registerQuery(app, scoped, detail, appUrl);
  registerSourceRecords(app, scoped, sessionOnly);
  app.get(base + "/wiki-pages", (r) =>
    scoped(r, (c, ws) => listWikiPages(c, ws, r.query)),
  );
  app.get(base + "/wiki-pages/:id", (r) =>
    scoped(r, (c, ws) => wikiPageDetail(c, ws, uuid.parse(params(r).id))),
  );
  app.get(base + "/wiki-pages/:id/revisions/:revision", (r) =>
    scoped(r, (c, ws) =>
      wikiPageDetail(
        c,
        ws,
        uuid.parse(params(r).id),
        z.coerce.number().int().positive().parse(params(r).revision),
      ),
    ),
  );
  app.get(base + "/articles", (r) =>
    scoped(r, (c, ws) => search(c, ws, r.query)),
  );
  app.get(base + "/articles/:id", (r) =>
    scoped(r, (c, ws) => detail(c, ws, uuid.parse(params(r).id))),
  );
  app.get(base + "/articles/:id/revisions/:revision", (r) =>
    scoped(r, (c, ws) =>
      detail(
        c,
        ws,
        uuid.parse(params(r).id),
        z.coerce.number().int().positive().parse(params(r).revision),
      ),
    ),
  );
  app.post(base + "/publications", (r) =>
    scoped(r, (c, ws) => publish(c, ws, r.body, r.identity!)),
  );
  app.get(base + "/publications/:key", (r) =>
    scoped(
      r,
      async (c, ws) =>
        requireRow(
          (
            await c.query(
              "SELECT result FROM publications WHERE workspace_id=$1 AND idempotency_key=$2",
              [ws, keySchema.parse(params(r).key)],
            )
          ).rows[0],
        ).result,
    ),
  );
  app.get(base + "/publications", (r) =>
    scoped(r, async (c, ws) => {
      const page = pagination(r.query);
      return paged(
        (
          await c.query(
            `SELECT p.id,p.producer,p.reason,p.created_at,
            p.result || jsonb_build_object('items', COALESCE((
              SELECT jsonb_agg(entry.item || jsonb_build_object('title', r.title) ORDER BY entry.position)
              FROM jsonb_array_elements(p.result->'items') WITH ORDINALITY AS entry(item,position)
              LEFT JOIN articles a ON a.workspace_id=p.workspace_id AND a.id=(entry.item->>'id')::uuid AND a.deleted_at IS NULL
              LEFT JOIN revisions r ON r.workspace_id=a.workspace_id AND r.article_id=a.id AND r.revision=(entry.item->>'revision')::int
            ), '[]'::jsonb)) AS result
          FROM publications p WHERE p.workspace_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT $2 OFFSET $3`,
            [ws, page.size + 1, page.offset],
          )
        ).rows,
        page,
      );
    }),
  );
  // Human editing uses the same atomic publication contract, without auto-verification.
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: base + "/articles" + (method === "PUT" ? "/:id" : ""),
      handler: (r) => {
        sessionOnly(r);
        const { reason, ...body } = r.body as Record<string, unknown>;
        return scoped(r, async (c, ws) => {
          const result = await publish(
            c,
            ws,
            {
              idempotencyKey: r.headers["idempotency-key"],
              producer:
                r.identity!.scope === "manage"
                  ? { type: "agent", client: "agent-wiki-cli" }
                  : { type: "human", client: "wiki-web" },
              reason: reason ?? "명시적 지식 편집",
              changes: [
                {
                  ...body,
                  clientRef: "web",
                  articleId: method === "PUT" ? params(r).id : null,
                },
              ],
            },
            r.identity!,
          );
          return detail(c, ws, result.items[0].id, result.items[0].revision);
        });
      },
    });
  app.delete(base + "/articles/:id", (r) => {
    sessionOnly(r);
    return scoped(r, async (c, ws) => {
      const rev = z
        .number()
        .int()
        .positive()
        .parse((r.body as any).revision);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        ws,
      ]);
      const changed = await c.query(
        "UPDATE articles SET deleted_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2 AND revision=$3 AND deleted_at IS NULL RETURNING id",
        [ws, uuid.parse(params(r).id), rev],
      );
      if (!changed.rowCount) conflict("REVISION_CONFLICT");
      await refreshWikiPages(c, ws);
      return { ok: true };
    });
  });
  app.post(base + "/claim-relations/reject", (r) => {
    sessionOnly(r);
    return scoped(r, (c, ws) =>
      rejectClaimRelation(c, ws, r.body, r.identity!),
    );
  });
  app.post(base + "/claim-relations/add", (r) => {
    sessionOnly(r);
    return scoped(r, (c, ws) => addClaimRelation(c, ws, r.body, r.identity!));
  });
  app.get(base + "/review/conflicts", (r) =>
    scoped(r, (c, ws) =>
      conflictsReview(c, ws, (r.query as { topic?: string }).topic),
    ),
  );
  app.post(base + "/consolidations", (r) => {
    sessionOnly(r);
    const body = z
      .union([
        z.object({ all: z.literal(true) }).strict(),
        z.object({ topicKey: topicKeySchema }).strict(),
      ])
      .parse(r.body);
    return scoped(r, async (c, ws) =>
      "all" in body
        ? triggerAllConsolidations(c, ws)
        : triggerConsolidation(c, ws, body.topicKey),
    );
  });
  app.get(base + "/consolidations", (r) =>
    scoped(r, (c, ws) =>
      consolidationStatus(c, ws, (r.query as { topicKey?: string }).topicKey),
    ),
  );
  app.get(base + "/subject-aliases", (r) =>
    scoped(r, (c, ws) => listSubjectAliases(c, ws)),
  );
  app.post(base + "/subject-aliases", (r) => {
    sessionOnly(r);
    const body = aliasInput.parse(r.body);
    return scoped(r, (c, ws) =>
      addSubjectAlias(c, ws, body, r.identity!.userId),
    );
  });
  // POST, not DELETE: every write on this API carries a JSON body so the
  // origin and content-type guards apply uniformly (app.ts).
  app.post(base + "/subject-aliases/remove", (r) => {
    sessionOnly(r);
    const body = z.object({ alias: topicKeySchema }).strict().parse(r.body);
    return scoped(r, (c, ws) => removeSubjectAlias(c, ws, body.alias));
  });
  app.get(base + "/subject-aliases/candidates", (r) => {
    const q = z
      .object({ min: z.coerce.number().min(0.1).max(1).optional() })
      .parse(r.query);
    return scoped(r, (c, ws) => subjectSplitCandidates(c, ws, q.min));
  });
  app.get(base + "/consolidations/plan", (r) => {
    const q = z.object({ topic: topicKeySchema.optional() }).parse(r.query);
    return scoped(r, (c, ws) => consolidationPlan(c, ws, q.topic));
  });
  app.get(base + "/reviews", (r) =>
    scoped(r, (c, ws) => pendingReviews(c, ws, r.query)),
  );
  app.get(base + "/articles/:id/comparison", (r) =>
    scoped(r, (c, ws) => {
      const q = z
        .object({ revision: z.coerce.number().int().positive().optional() })
        .parse(r.query);
      return reviewComparison(c, ws, uuid.parse(params(r).id), q.revision);
    }),
  );
  app.post(base + "/articles/:id/review", (r) =>
    scoped(r, (c, ws) =>
      confirmReview(
        c,
        ws,
        uuid.parse(params(r).id),
        r.body,
        r.identity!.userId,
      ),
    ),
  );
  app.get(base + "/context", (r) =>
    scoped(r, (c, ws) => {
      const q = z
        .object({
          q: z.string().min(1).max(200),
          tag: z.string().max(40).optional(),
          view: z.enum(["current", "history"]).default("current"),
          scope: z.string().trim().max(200).optional(),
        })
        .parse(r.query);
      return context(appUrl, c, ws, q.q, q.tag, false, q.view, q.scope);
    }),
  );
  app.get(base + "/recall", (r) =>
    scoped(r, (c, ws) => {
      const q = z.object({ tag: z.string().min(1).max(40) }).parse(r.query);
      return context(appUrl, c, ws, "", q.tag, true);
    }),
  );
}
