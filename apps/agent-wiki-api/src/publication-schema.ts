import { z } from "zod";
import { AppError } from "../../../packages/core/src/db.js";
import {
  evidenceInput,
  claimState,
  claimRelationInput,
} from "./claim-relations.js";
export const uuid = z.string().uuid();
export const small = z.string().trim().min(1).max(200);
export const keySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[\w-]+$/);
const claimInput = z
  .object({
    anchor: z.string().regex(/^[\w-]{1,80}$/),
    text: z.string().min(1).max(10000),
    type: z.enum([
      "user_decision",
      "observation",
      "ai_inference",
      "unconfirmed",
      "author_statement",
    ]),
    evidence: z.array(evidenceInput).max(20).default([]),
    subject: z.string().trim().max(200).default(""),
    scope: z.string().trim().max(200).default(""),
    state: claimState.default("current"),
  })
  .strict();
export const MAX_PUBLICATION_CHANGES = 12;
export const changeInput = z
  .object({
    clientRef: small,
    topic: z
      .object({
        key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
        title: small,
      })
      .strict()
      .optional(),
    articleId: uuid.nullable().default(null),
    baseRevision: z.number().int().positive().nullable().default(null),
    title: small,
    content: z.string().min(1).max(100000),
    kind: z.enum(["article", "memory", "glossary"]).default("article"),
    folder: z.string().max(120).default(""),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    aliases: z.array(small).max(20).default([]),
    claims: z.array(claimInput).max(100).default([]),
    links: z.array(small).max(30).default([]),
    supersedes: z.array(uuid).max(20).default([]),
    claimRelations: z.array(claimRelationInput).max(30).default([]),
  })
  .strict()
  .superRefine((change, ctx) => {
    const anchors = new Set(change.claims.map((claim) => claim.anchor));
    change.claimRelations.forEach((relation, index) => {
      if (!anchors.has(relation.anchor))
        ctx.addIssue({
          code: "custom",
          path: ["claimRelations", index, "anchor"],
          message:
            "Relation source anchor must identify a claim in this change",
        });
    });
  });
export const publicationInput = z
  .object({
    idempotencyKey: keySchema,
    producer: z
      .object({
        type: z.enum(["agent", "human"]),
        client: small,
        skillVersion: small.optional(),
        model: small.optional(),
      })
      .strict(),
    reason: z.string().max(2000).default(""),
    inputs: z
      .array(
        z
          .object({ articleId: uuid, revision: z.number().int().positive() })
          .strict(),
      )
      .max(30)
      .default([]),
    claimInputs: z
      .array(
        z
          .object({
            articleId: uuid,
            revision: z.number().int().positive(),
            anchor: z.string(),
            state: claimState,
          })
          .strict(),
      )
      .max(30)
      .default([]),
    changes: z.array(changeInput).min(1).max(MAX_PUBLICATION_CHANGES),
    startContext: z
      .object({ tag: z.string().min(1).max(40), articleRef: small })
      .strict()
      .optional(),
  })
  .strict();
export type ChangeInput = z.infer<typeof changeInput>;
export type PublicationInput = z.infer<typeof publicationInput>;
// Stable serialization for idempotency fingerprints: sorted keys, no whitespace.
export const canonical = (v: unknown): string =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : "{" +
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
          .join(",") +
        "}";
export function conflict(code: string): never {
  throw new AppError(409, code);
}
