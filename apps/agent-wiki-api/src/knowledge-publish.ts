import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, requireRow } from "../../../packages/core/src/db.js";
import { hash, getSource } from "../../../packages/core/src/storage.js";
import { cacheSourceTimes } from "./evidence-time.js";
import {
  sourceRoles,
  roleRanges,
  evidenceHasRole,
} from "../../../packages/core/src/source-roles.js";
import { refreshWikiPages } from "./wiki-pages.js";
import {
  storeClaimRelations,
  effectiveClaimState,
  type DeferredRelation,
} from "./claim-relations.js";
import { scheduleConsolidation } from "../../../packages/core/src/consolidation.js";
import {
  uuid,
  changeInput,
  publicationInput,
  canonical,
  conflict,
} from "./publication-schema.js";
// Consolidation is deliberately exact: model-reused canonical wording, subject,
// scope, kind and authority must agree. Similarity alone never merges decisions.
async function consolidateClaim(
  c: PoolClient,
  ws: string,
  change: z.infer<typeof changeInput>,
  publicationId: string,
) {
  if (
    change.articleId ||
    change.claims.length !== 1 ||
    change.claimRelations.length ||
    change.links.length ||
    change.supersedes.length
  )
    return change;
  const incoming = change.claims[0];
  if (
    !incoming.subject ||
    !incoming.scope ||
    !["current", "proposed"].includes(incoming.state) ||
    !incoming.evidence.length
  )
    return change;
  const matches = (
    await c.query(
      `SELECT a.*,cl.anchor FROM articles a JOIN claims cl ON cl.workspace_id=a.workspace_id AND cl.article_id=a.id AND cl.revision=a.revision
     WHERE a.workspace_id=$1 AND a.deleted_at IS NULL AND (SELECT count(*) FROM claims siblings WHERE siblings.workspace_id=a.workspace_id AND siblings.article_id=a.id AND siblings.revision=a.revision)=1 AND a.kind=$2 AND cl.text=$3 AND cl.subject=$4 AND cl.scope=$5 AND cl.type=$6 AND (${effectiveClaimState("cl")})=$7
     AND NOT EXISTS(SELECT 1 FROM revisions r WHERE r.workspace_id=a.workspace_id AND r.article_id=a.id AND r.revision=a.revision AND r.publication_id=$8)
     ORDER BY a.created_at,a.id LIMIT 2`,
      [
        ws,
        change.kind,
        incoming.text,
        incoming.subject,
        incoming.scope,
        incoming.type,
        incoming.state,
        publicationId,
      ],
    )
  ).rows;
  if (matches.length !== 1) return change; // Ambiguous existing duplicates need review.
  const article = matches[0];
  const claims = (
    await c.query(
      `SELECT cl.*,${effectiveClaimState("cl")} AS effective_state FROM claims cl WHERE workspace_id=$1 AND article_id=$2 AND revision=$3 ORDER BY anchor`,
      [ws, article.id, article.revision],
    )
  ).rows;
  const evidence = (
    await c.query(
      "SELECT * FROM evidence WHERE workspace_id=$1 AND article_id=$2 AND revision=$3",
      [ws, article.id, article.revision],
    )
  ).rows;
  const links = (
    await c.query(
      "SELECT to_id FROM links WHERE workspace_id=$1 AND from_id=$2 AND relation='links_to'",
      [ws, article.id],
    )
  ).rows.map((r) => r.to_id);
  return {
    ...change,
    articleId: article.id,
    baseRevision: article.revision,
    topic: article.topic_key
      ? { key: article.topic_key, title: article.topic_title }
      : change.topic,
    title: article.title,
    content: article.content,
    kind: article.kind,
    folder: article.folder,
    tags: [...new Set([...article.tags, ...change.tags])],
    aliases: article.aliases,
    links,
    claimRelations: [
      {
        anchor: article.anchor,
        relation: "supports" as const,
        target: {
          articleId: article.id,
          revision: article.revision,
          anchor: article.anchor,
        },
        evidence: incoming.evidence.slice(0, 10),
      },
    ],
    claims: claims.map((claim) => ({
      anchor: claim.anchor,
      text: claim.text,
      type: claim.type,
      subject: claim.subject,
      scope: claim.scope,
      state: claim.effective_state,
      evidence: [
        ...evidence
          .filter((e) => e.anchor === claim.anchor)
          .map((e) => ({
            sourceId: e.source_id,
            revision: e.source_revision,
            lines: [e.line_start, e.line_end] as [number, number],
            quote: e.quote,
          })),
        ...(claim.anchor === article.anchor ? incoming.evidence : []),
      ],
    })),
  };
}

function coalesceClaims(changes: z.infer<typeof changeInput>[]) {
  if (
    changes.some(
      (x) =>
        x.links.length ||
        x.supersedes.length ||
        x.claimRelations.some((relation) => "clientRef" in relation.target),
    )
  )
    return changes;
  const selected: typeof changes = [],
    seen = new Map<string, (typeof changes)[number]>();
  for (const change of changes) {
    const claim = change.claims[0];
    if (
      change.articleId ||
      change.claimRelations.length ||
      change.claims.length !== 1 ||
      !claim.subject ||
      !claim.scope
    ) {
      selected.push(change);
      continue;
    }
    const key = JSON.stringify([
      change.kind,
      claim.text,
      claim.type,
      claim.subject,
      claim.scope,
      claim.state,
    ]);
    const prior = seen.get(key);
    if (prior) {
      prior.claims[0].evidence.push(...claim.evidence);
      prior.tags = [...new Set([...prior.tags, ...change.tags])];
    } else {
      seen.set(key, change);
      selected.push(change);
    }
  }
  return selected;
}

export async function publish(
  c: PoolClient,
  ws: string,
  raw: unknown,
  identity: { userId: string; scope: string },
) {
  const input = publicationInput.parse(raw);
  if (identity.scope !== "session" && input.producer.type !== "agent")
    throw new AppError(403, "AGENT_PRODUCER_REQUIRED");
  if (Buffer.byteLength(input.changes.map((x) => x.content).join("")) > 100000)
    throw new AppError(413, "PUBLICATION_TOO_LARGE");
  const refs = input.changes.map((x) => x.clientRef);
  const edits = input.changes.flatMap((x) =>
    x.articleId ? [x.articleId] : [],
  );
  if (
    new Set(refs).size !== refs.length ||
    new Set(edits).size !== edits.length
  )
    throw new AppError(400, "DUPLICATE_CHANGE");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [ws]);
  const fingerprint = hash(canonical(input));
  const old = (
    await c.query(
      "SELECT * FROM publications WHERE workspace_id=$1 AND idempotency_key=$2",
      [ws, input.idempotencyKey],
    )
  ).rows[0];
  if (old) {
    if (old.payload_hash !== fingerprint) conflict("IDEMPOTENCY_CONFLICT");
    return old.result;
  }
  for (const prior of input.inputs)
    requireRow(
      (
        await c.query(
          "SELECT r.article_id FROM revisions r JOIN articles a ON a.id=r.article_id AND a.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.article_id=$2 AND r.revision=$3 AND a.deleted_at IS NULL",
          [ws, prior.articleId, prior.revision],
        )
      ).rows[0],
    );
  const automatic =
    input.producer.client === "remote-worker" && identity.scope === "publish";
  if (automatic) {
    for (const prior of input.inputs) {
      const current = (
        await c.query(
          "SELECT revision FROM articles WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
          [ws, prior.articleId],
        )
      ).rows[0];
      if (!current || current.revision !== prior.revision)
        conflict("CURATION_CONTEXT_CHANGED");
    }
    for (const prior of input.claimInputs) {
      const current = (
        await c.query(
          `SELECT ${effectiveClaimState("cl")} AS state FROM claims cl WHERE workspace_id=$1 AND article_id=$2 AND revision=$3 AND anchor=$4`,
          [ws, prior.articleId, prior.revision, prior.anchor],
        )
      ).rows[0];
      if (!current || current.state !== prior.state)
        conflict("CURATION_CONTEXT_CHANGED");
    }
  }
  if (automatic) input.changes = coalesceClaims(input.changes);
  const publicationId = randomUUID();
  await c.query(
    "INSERT INTO publications(id,workspace_id,idempotency_key,payload_hash,producer,reason) VALUES($1,$2,$3,$4,$5,$6)",
    [
      publicationId,
      ws,
      input.idempotencyKey,
      fingerprint,
      JSON.stringify({
        ...input.producer,
        actorId: identity.userId,
        inputs: input.inputs,
      }),
      input.reason,
    ],
  );
  const mapped = new Map(
    input.changes.map((x) => [x.clientRef, x.articleId ?? randomUUID()]),
  );
  const sources = new Map<string, { text: string; row: any }>();
  // Lazily computed per sourceId: which lines are user/assistant/tool/unknown
  // authority, for the DECISION_EVIDENCE_NOT_USER gate below. Read transport
  // structure only, same rule the extraction chunk already applies.
  const roleCache = new Map<string, ReturnType<typeof roleRanges>>();
  const rolesFor = (sourceId: string, lineCount: number) => {
    let ranges = roleCache.get(sourceId);
    if (!ranges) {
      ranges = roleRanges(sourceRoles(sources.get(sourceId)!.text), 1, lineCount);
      roleCache.set(sourceId, ranges);
    }
    return ranges;
  };
  const results: { clientRef: string; id: string; revision: number }[] = [];
  const deferredRelations: DeferredRelation[] = [];
  for (let i = 0; i < input.changes.length; i++) {
    const change = automatic
      ? await consolidateClaim(c, ws, input.changes[i], publicationId)
      : input.changes[i];
    input.changes[i] = change;
    if (change.articleId) mapped.set(change.clientRef, change.articleId);
    const id = mapped.get(change.clientRef)!;
    if (change.articleId === null && change.baseRevision !== null)
      throw new AppError(400, "INVALID_BASE_REVISION");
    if (change.articleId !== null) {
      const old = requireRow(
        (
          await c.query(
            "SELECT revision FROM articles WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
            [ws, id],
          )
        ).rows[0],
      );
      if (old.revision !== change.baseRevision) conflict("REVISION_CONFLICT");
    }
    const revision = (change.baseRevision ?? 0) + 1;
    const claims = change.claims.length
      ? change.claims
      : [
          {
            anchor: "statement",
            text: change.content.slice(0, 10000),
            type: "author_statement",
            evidence: [],
            subject: "",
            scope: "",
            state: "current",
          },
        ];
    if (new Set(claims.map((x) => x.anchor)).size !== claims.length)
      throw new AppError(400, "DUPLICATE_CLAIM");
    for (const claim of claims) {
      if (!change.content.includes(claim.text))
        throw new AppError(400, "CLAIM_NOT_IN_CONTENT");
      // subject must name the specific thing, not restate the page it sits on.
      // "subject = topic key" is how an extraction says "no subject" while
      // looking like it answered, and it splits nothing: every such claim lands
      // in one bucket that Consolidation can never reason about.
      if (change.topic && claim.subject === change.topic.key)
        throw new AppError(400, "CLAIM_SUBJECT_IS_TOPIC");
      if (
        !claim.evidence.length &&
        !["author_statement", "agent_statement"].includes(claim.type)
      )
        throw new AppError(400, "EVIDENCE_REQUIRED");
      for (const ev of claim.evidence) {
        if (!sources.has(ev.sourceId)) {
          const row = requireRow(
            (
              await c.query(
                "SELECT * FROM sources WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE",
                [ws, ev.sourceId],
              )
            ).rows[0],
          );
          const text = await getSource(row.object_key);
          await cacheSourceTimes(c, ws, ev.sourceId, text);
          if (hash(text) !== row.content_hash)
            throw new AppError(500, "SOURCE_HASH_MISMATCH");
          sources.set(ev.sourceId, { text, row });
        }
        const source = sources.get(ev.sourceId)!;
        const [start, end] = ev.lines;
        if (
          end < start ||
          end > source.row.line_count ||
          source.text
            .split("\n")
            .slice(start - 1, end)
            .join("\n") !== ev.quote
        )
          throw new AppError(400, "EVIDENCE_MISMATCH");
      }
      // A decision claim must be traceable to something the user actually
      // said, not just an agent's summary of one. Role-tagged transport
      // structure only exists for collected conversation sources, which is
      // exactly what the automatic (worker) pipeline reads; a manual/human
      // publish has no such structure to check and is left alone. Checked
      // here, not only in the worker's own proposal validation, so every
      // automatic publisher passes it rather than each one re-implementing it.
      // Scope, precisely: at least one cited line must be user-authored. A
      // decision backed by a user line plus a tool output stays valid, and
      // consolidateClaim's merge can still attach assistant-role evidence to a
      // claim that already has its user citation — the claim's authority rests
      // on that citation, and extra corroboration does not revoke it.
      // Skipped when none of the cited evidence resolves to any known role at
      // all (plain, non-transport text): role data is genuinely unavailable
      // there, not evidence of a non-user author.
      const claimRoleRanges = claim.evidence.map((ev) =>
        rolesFor(ev.sourceId, sources.get(ev.sourceId)!.row.line_count),
      );
      const roleDataAvailable = claimRoleRanges.some((ranges) =>
        ranges.some((r) => r.role !== "unknown"),
      );
      if (
        automatic &&
        claim.type === "user_decision" &&
        roleDataAvailable &&
        !claim.evidence.some((ev, i) =>
          evidenceHasRole([ev], claimRoleRanges[i], ["user"]),
        )
      )
        throw new AppError(400, "DECISION_EVIDENCE_NOT_USER");
    }
    if (change.articleId)
      await c.query(
        "UPDATE articles SET title=$3,content=$4,kind=$5,folder=$6,tags=$7,aliases=$8,revision=$9,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [
          ws,
          id,
          change.title,
          change.content,
          change.kind,
          change.folder,
          change.tags,
          change.aliases,
          revision,
        ],
      );
    else
      await c.query(
        "INSERT INTO articles(id,workspace_id,title,content,kind,folder,tags,aliases) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          ws,
          change.title,
          change.content,
          change.kind,
          change.folder,
          change.tags,
          change.aliases,
        ],
      );
    if (change.topic)
      await c.query(
        "UPDATE articles SET topic_key=$3,topic_title=$4 WHERE workspace_id=$1 AND id=$2",
        [ws, id, change.topic.key, change.topic.title],
      );
    await c.query(
      "INSERT INTO revisions(workspace_id,article_id,revision,title,content,metadata,publication_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        ws,
        id,
        revision,
        change.title,
        change.content,
        JSON.stringify({
          topic: change.topic,
          kind: change.kind,
          folder: change.folder,
          tags: change.tags,
          aliases: change.aliases,
          links: change.links,
          supersedes: change.supersedes,
        }),
        publicationId,
      ],
    );
    for (const claim of claims) {
      await c.query(
        "INSERT INTO claims(workspace_id,article_id,revision,anchor,text,type,subject,scope,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          ws,
          id,
          revision,
          claim.anchor,
          claim.text,
          claim.type,
          claim.subject,
          claim.scope,
          claim.state,
        ],
      );
      for (const ev of claim.evidence)
        await c.query(
          "INSERT INTO evidence(workspace_id,article_id,revision,anchor,source_id,source_revision,line_start,line_end,quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",
          [
            ws,
            id,
            revision,
            claim.anchor,
            ev.sourceId,
            ev.revision,
            ...ev.lines,
            ev.quote,
          ],
        );
    }
    const localTargets = new Set<string>();
    const resolvedRelations = change.claimRelations.map((relation) => {
      if (!("clientRef" in relation.target))
        return { ...relation, target: relation.target };
      const ref = relation.target.clientRef;
      const prior = results.find((item) => item.clientRef === ref);
      if (!prior) throw new AppError(400, "CLAIM_LOCAL_TARGET_NOT_PRIOR");
      localTargets.add(prior.id);
      return {
        ...relation,
        target: {
          articleId: prior.id,
          revision: prior.revision,
          anchor: relation.target.anchor,
        },
      };
    });
    const { deferred } = await storeClaimRelations(
      c,
      ws,
      id,
      revision,
      publicationId,
      resolvedRelations,
      localTargets,
      automatic,
    );
    deferredRelations.push(...deferred);
    results.push({ clientRef: change.clientRef, id, revision });
  }
  for (const change of input.changes) {
    const id = mapped.get(change.clientRef)!;
    await c.query("DELETE FROM links WHERE workspace_id=$1 AND from_id=$2", [
      ws,
      id,
    ]);
    for (const [relation, targets] of [
      ["links_to", change.links],
      ["supersedes", change.supersedes],
    ] as const) {
      for (const ref of targets) {
        const target = mapped.get(ref) ?? uuid.parse(ref);
        if (target === id) throw new AppError(400, "SELF_LINK");
        requireRow(
          (
            await c.query(
              "SELECT id FROM articles WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
              [ws, target],
            )
          ).rows[0],
        );
        await c.query(
          "INSERT INTO links VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [ws, id, target, relation],
        );
      }
    }
    await c.query(
      "UPDATE revisions SET metadata=metadata || jsonb_build_object('resolvedLinks',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',to_id,'relation',relation)) FROM links WHERE workspace_id=$1 AND from_id=$2),'[]'::jsonb)) WHERE workspace_id=$1 AND article_id=$2 AND revision=(SELECT revision FROM articles WHERE workspace_id=$1 AND id=$2)",
      [ws, id],
    );
  }
  const cycle = await c.query(
    `WITH RECURSIVE chain(origin,node,path,cycle) AS (SELECT from_id,to_id,ARRAY[from_id,to_id],false FROM links WHERE workspace_id=$1 AND relation='supersedes' UNION ALL SELECT c.origin,l.to_id,c.path||l.to_id,l.to_id=ANY(c.path) FROM chain c JOIN links l ON l.from_id=c.node AND l.workspace_id=$1 AND l.relation='supersedes' WHERE NOT c.cycle) SELECT 1 FROM chain WHERE cycle LIMIT 1`,
    [ws],
  );
  if (cycle.rowCount) throw new AppError(400, "SUPERSESSION_CYCLE");
  if (deferredRelations.length)
    await recordDeferredRelations(c, ws, publicationId, deferredRelations);
  await refreshWikiPages(c, ws);
  if (input.startContext) {
    const id =
      mapped.get(input.startContext.articleRef) ??
      uuid.parse(input.startContext.articleRef);
    requireRow(
      (
        await c.query(
          "SELECT id FROM articles WHERE workspace_id=$1 AND id=$2 AND $3=ANY(tags) AND deleted_at IS NULL",
          [ws, id, input.startContext.tag],
        )
      ).rows[0],
    );
    await c.query(
      "INSERT INTO project_contexts VALUES($1,$2,$3) ON CONFLICT(workspace_id,tag) DO UPDATE SET article_id=EXCLUDED.article_id",
      [ws, input.startContext.tag, id],
    );
  }
  const result = {
    id: publicationId,
    idempotencyKey: input.idempotencyKey,
    items: results,
    ...(deferredRelations.length
      ? { deferredRelations: deferredRelations.length }
      : {}),
  };
  await c.query(
    "UPDATE publications SET result=$3 WHERE workspace_id=$1 AND id=$2",
    [ws, publicationId, JSON.stringify(result)],
  );
  return result;
}
// A relation-only failure keeps the extraction's claims/evidence; the
// relation itself waits here for the topic's next Consolidation Job
// (docs/l2-l3-memory.md#관계-지연--대기함). Never silently dropped, never
// stuck waiting on a person.
async function recordDeferredRelations(
  c: PoolClient,
  ws: string,
  publicationId: string,
  deferred: DeferredRelation[],
) {
  const topics = new Map<string, string>();
  for (const item of deferred) {
    if (!topics.has(item.fromArticleId)) {
      const row = (
        await c.query(
          "SELECT topic_key FROM articles WHERE workspace_id=$1 AND id=$2",
          [ws, item.fromArticleId],
        )
      ).rows[0];
      topics.set(item.fromArticleId, (row?.topic_key as string) ?? "");
    }
    const topicKey = topics.get(item.fromArticleId)!;
    await c.query(
      `INSERT INTO consolidation_inbox(workspace_id,from_article_id,from_revision,from_anchor,to_article_id,to_revision,to_anchor,relation,evidence,source_run_id,error_code)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        ws,
        item.fromArticleId,
        item.fromRevision,
        item.fromAnchor,
        item.target.articleId,
        item.target.revision,
        item.target.anchor,
        item.relation,
        JSON.stringify(item.evidence),
        publicationId,
        item.errorCode,
      ],
    );
    if (topicKey) await scheduleConsolidation(c, ws, topicKey, "deferred");
  }
}
