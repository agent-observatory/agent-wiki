import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, requireRow } from "../../../packages/core/src/db.js";
import { publish } from "./knowledge-publish.js";
import { republishChange } from "./claim-relation-reject.js";
import { small } from "./publication-schema.js";
// `agent-wiki relation add`: the user authors a relation the machine never
// proposed (or proposed and got rejected). It republishes the FROM claim's
// article as a corrective Version carrying a new claimRelations entry, the
// same mechanism `claim-relation-reject.ts` uses to publish a corrective
// Version — but adding a relation instead of undoing one. Every existing
// storeClaimRelations gate still runs (via publish()); nothing here bypasses
// them. docs/l2-l3-memory.md#relation-reject--자동-반영을-되돌리는-명령.
const claimRef = z
  .object({
    articleId: z.string().uuid(),
    revision: z.number().int().positive(),
    anchor: z.string().regex(/^[\w-]{1,80}$/),
  })
  .strict();
export const addRelationInput = z
  .object({
    from: claimRef,
    to: claimRef,
    relation: z.enum(["supersedes", "retracts", "contradicts", "supports"]),
    client: small,
    reason: z.string().min(1).max(2000),
  })
  .strict();
export type AddRelationInput = z.infer<typeof addRelationInput>;
export async function addClaimRelation(
  c: PoolClient,
  ws: string,
  raw: unknown,
  identity: { userId: string; scope?: string },
) {
  const input = addRelationInput.parse(raw);
  const article = requireRow(
    (
      await c.query(
        "SELECT revision FROM articles WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
        [ws, input.from.articleId],
      )
    ).rows[0],
  );
  // The FROM claim must be the article's current Version: republishChange
  // always republishes the current content, so a stale ref here would
  // silently attach the relation to different claims than the caller saw.
  if (article.revision !== input.from.revision)
    throw new AppError(409, "RELATION_SOURCE_NOT_CURRENT");
  const change = await republishChange(c, ws, input.from.articleId);
  const claim = change.claims.find((cl) => cl.anchor === input.from.anchor);
  if (!claim) throw new AppError(404, "CLAIM_NOT_FOUND");
  // storeClaimRelations would reject an empty evidence array anyway
  // (CLAIM_RELATION_EVIDENCE_REQUIRED), but failing here names the real
  // cause instead of a schema error deep in publish().
  if (!claim.evidence.length)
    throw new AppError(400, "CLAIM_RELATION_EVIDENCE_REQUIRED");
  const scope = identity.scope ?? "manage";
  const result = await publish(
    c,
    ws,
    {
      idempotencyKey: "relation-add-" + randomUUID(),
      // Matches claim-relation-reject.ts's convention: a "manage"-scoped
      // caller (CLI, possibly run by an agent) publishes as agent; a
      // session-scoped caller (the web UI, if ever used here) as human.
      producer: {
        type: scope === "session" ? "human" : "agent",
        client: input.client,
      },
      reason: "관계 추가 · " + input.reason,
      changes: [
        {
          ...change,
          claimRelations: [
            {
              anchor: input.from.anchor,
              relation: input.relation,
              target: input.to,
              // Only the FROM claim's own evidence ever satisfies
              // CLAIM_RELATION_EVIDENCE_REQUIRED; there is no user-facing
              // evidence-selection step, so all of it (bounded to the
              // schema's max of 10) is offered.
              evidence: claim.evidence.slice(0, 10),
            },
          ],
        },
      ],
    },
    { userId: identity.userId, scope },
  );
  return { ok: true, publicationId: result.id };
}
