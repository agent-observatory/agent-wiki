import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  roleRanges,
  sourceRoles,
} from "../../../packages/core/src/source-roles.js";
import { tx, AppError } from "../../../packages/core/src/db.js";
import { getSources, hash } from "../../../packages/core/src/storage.js";
import {
  aiConfig,
  decryptSecret,
  callModel,
  ModelError,
} from "../../../packages/core/src/ai.js";
import {
  checkCurationControl,
  stopForQuota,
} from "../../../packages/core/src/curation-control.js";
import {
  modelGateKey,
  waitForModelSlot,
} from "../../../packages/core/src/model-gate.js";
import { modelSource } from "../../../packages/core/src/model-records.js";
import { inputTokenCounter } from "../../../packages/core/src/input-tokens.js";
import {
  CURATION_INPUT_VERSION,
  curationInput,
} from "../../../packages/core/src/curation-input.js";
import { modelCallPredicate } from "../../../packages/core/src/model-call-history.js";
import { reprocessPlan } from "../../agent-wiki-api/src/curation-reprocess.js";
import { curationContext, contextBudget } from "./curation-context.js";
import { prepareProposal } from "./curation-proposal.js";
// Reanalysis produces a review candidate; it never publishes or rewinds coverage.
export async function runReprocess(
  owner: string,
  signal: AbortSignal,
  instruction: string,
  promptVersion: string,
  modelCall = callModel,
) {
  if (signal.aborted) return false;
  const spaces = await tx(
    owner,
    null,
    async (c) =>
      (await c.query("SELECT id FROM workspaces ORDER BY created_at")).rows,
  );
  for (const { id: ws } of spaces) {
    const task = await tx(owner, ws, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        ws + "settings",
      ]);
      await c.query(
        "WITH expired AS (UPDATE curation_reprocesses SET status='failed',error_code='REPROCESS_INTERRUPTED',lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND status='running' AND lease_until<now() RETURNING run_id) UPDATE refinement_runs SET status='failed',error_code='REPROCESS_INTERRUPTED',finished_at=now() WHERE workspace_id=$1 AND id IN (SELECT run_id FROM expired) AND status='running'",
        [ws],
      );
      const settings = (
        await c.query("SELECT * FROM ai_settings WHERE workspace_id=$1", [ws])
      ).rows[0];
      if (!settings?.config.enabled || !settings.encrypted_key) return null;
      if (
        (
          await c.query(
            "SELECT 1 FROM refinement_jobs WHERE workspace_id=$1 AND status='running' UNION ALL SELECT 1 FROM curation_reprocesses WHERE workspace_id=$1 AND status='running' LIMIT 1",
            [ws],
          )
        ).rowCount
      )
        return null;
      const request = (
        await c.query(
          "SELECT * FROM curation_reprocesses WHERE workspace_id=$1 AND status='pending' ORDER BY created_at,id LIMIT 1 FOR UPDATE",
          [ws],
        )
      ).rows[0];
      if (!request) return null;
      const config = aiConfig.parse(settings.config);
      if (
        config.dailyCalls !== null &&
        (
          await c.query(
            `SELECT count(*)::int AS n FROM refinement_runs WHERE workspace_id=$1 AND ${modelCallPredicate} AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
            [ws],
          )
        ).rows[0].n >= config.dailyCalls
      )
        return null;
      const original = (
        await c.query(
          "SELECT * FROM refinement_runs WHERE workspace_id=$1 AND id=$2",
          [ws, request.original_run_id],
        )
      ).rows[0];
      const runId = randomUUID();
      await c.query(
        "INSERT INTO refinement_runs(id,workspace_id,job_id,settings,prompt_version,chunk_index,diagnostics) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          runId,
          ws,
          original.job_id,
          JSON.stringify({ ...config, version: settings.version }),
          promptVersion,
          original.chunk_index,
          JSON.stringify({
            kind: "reprocess",
            reprocessId: request.id,
            originalRunId: original.id,
            stage: "prepare",
          }),
        ],
      );
      await c.query(
        "UPDATE curation_reprocesses SET status='running',run_id=$3,lease_until=now()+interval '7 minutes',updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [ws, request.id, runId],
      );
      return {
        request,
        original,
        config,
        settingsVersion: settings.version,
        secret: decryptSecret(settings.encrypted_key),
        runId,
      };
    });
    if (!task) continue;
    const diag: Record<string, unknown> = {
      kind: "reprocess",
      reprocessId: task.request.id,
      originalRunId: task.original.id,
      stage: "prepare",
      httpRequests: 0,
    };
    let reportedUsage: Record<string, unknown> | undefined;
    let response: Awaited<ReturnType<typeof callModel>> | undefined;
    try {
      const current = await tx(owner, ws, (c) =>
        reprocessPlan(c, ws, task.original.id),
      );
      if (current.fingerprint !== task.request.plan.fingerprint)
        throw new ModelError("REPROCESS_PLAN_CHANGED");
      const input = structuredClone(task.original.input);
      const spans = input.source.spans;
      const rows = await tx(
        owner,
        ws,
        async (c) =>
          (
            await c.query(
              "SELECT id,object_key,content_hash FROM sources WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL",
              [ws, spans.map((s: any) => s.id)],
            )
          ).rows,
      );
      if (rows.length !== spans.length) throw new ModelError("SOURCE_DELETED");
      const texts = await getSources(
        spans.map((s: any) => rows.find((r) => r.id === s.id).object_key),
      );
      spans.forEach((s: any, i: number) => {
        if (
          hash(texts[i]) !== s.hash ||
          rows.find((r) => r.id === s.id).content_hash !== s.hash
        )
          throw new ModelError("SOURCE_HASH_MISMATCH");
      });
      const projections = texts.map(curationInput);
      input.source.roles = roleRanges(
        texts.flatMap(sourceRoles),
        input.source.start,
        input.source.end,
      );
      input.source.omittedLines = projections
        .flatMap((p, i) =>
          p.omitted.map((r) => ({
            ...r,
            start: r.start + spans[i].start - 1,
            end: r.end + spans[i].start - 1,
          })),
        )
        .filter(
          (r) => r.start <= input.source.end && r.end >= input.source.start,
        );
      input.source.text = texts
        .map((t) => curationInput(t).text)
        .join("\n")
        .split("\n")
        .slice(input.source.start - 1, input.source.end)
        .join("\n");
      if (task.request.mode === "revalidate") {
        if (
          task.original.prompt_version !== promptVersion ||
          task.original.diagnostics.inputVersion !== CURATION_INPUT_VERSION ||
          input.source.text !== task.original.input.source.text
        )
          throw new ModelError("REPROCESS_CACHE_INCOMPATIBLE");
        response = { output: task.original.output, usage: {} };
        await tx(owner, ws, (c) =>
          c.query(
            "UPDATE refinement_runs SET input=$3 WHERE workspace_id=$1 AND id=$2",
            [ws, task.runId, JSON.stringify(input)],
          ),
        );
        diag.skippedReason = "saved_output_revalidation";
      } else {
        const counter = await inputTokenCounter(task.config);
        const context = await tx(owner, ws, (c) =>
          curationContext(
            c,
            ws,
            input.source.id,
            input.source.text,
            contextBudget(task.config.maxInputTokens),
            counter.count,
          ),
        );
        input.related = context.related;
        diag.contextSelection = context.diagnostics;
        input.topics = await tx(
          owner,
          ws,
          async (c) =>
            (
              await c.query(
                "SELECT topic_key AS key,title FROM wiki_pages WHERE workspace_id=$1 ORDER BY topic_key LIMIT 40",
                [ws],
              )
            ).rows,
        );
        delete input.validationRetry;
        const messages = [
          { role: "system", content: instruction },
          {
            role: "user",
            content: JSON.stringify({
              ...input,
              source: modelSource(input.source),
            }),
          },
        ];
        const estimated = messages.reduce(
          (n, m) => n + counter.count(m.content),
          128,
        );
        diag.inputBudget = {
          estimatedTokens: estimated,
          limit: task.config.maxInputTokens,
          counter: counter.version,
        };
        if (estimated > task.config.maxInputTokens)
          throw new ModelError("AI_INPUT_LIMIT");
        const callSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(330000),
          ]),
          gate = modelGateKey(task.config.baseUrl, task.secret);
        await waitForModelSlot(
          owner,
          gate,
          callSignal,
          task.config.requestsPerMinute,
        );
        if (!(await checkCurationControl(owner, ws, task.settingsVersion)))
          throw new ModelError("CURATION_CONTROL_CHANGED");
        const lease = await tx(owner, ws, (c) =>
          c.query(
            "UPDATE curation_reprocesses SET lease_until=now()+interval '7 minutes' WHERE workspace_id=$1 AND id=$2 AND run_id=$3 AND status='running' RETURNING id",
            [ws, task.request.id, task.runId],
          ),
        );
        if (!lease.rowCount) throw new ModelError("REPROCESS_LEASE_LOST");
        diag.stage = "model";
        diag.requestedAt = new Date().toISOString();
        diag.httpRequests = 1;
        await tx(owner, ws, (c) =>
          c.query(
            "UPDATE refinement_runs SET input=$3,diagnostics=diagnostics||$4::jsonb WHERE workspace_id=$1 AND id=$2",
            [ws, task.runId, JSON.stringify(input), JSON.stringify(diag)],
          ),
        );
        const start = performance.now();
        try {
          response = await modelCall(
            task.config,
            task.secret,
            messages,
            callSignal,
            () =>
              waitForModelSlot(
                owner,
                gate,
                callSignal,
                task.config.requestsPerMinute,
              ),
            (e) => {
              if (e.type === "usage") reportedUsage = e.usage;
              if (e.type === "response") diag.httpStatus = e.status;
              if (e.type === "poll")
                diag.httpRequests = Number(diag.httpRequests) + 1;
            },
          );
        } finally {
          diag.durationMs = Math.round(performance.now() - start);
        }
      }
      diag.stage = "validate";
      const result = prepareProposal(response.output, input, diag);
      const candidate = {
        changes: result.changes,
        previous: current.claims,
        sourceRange: { start: input.source.start, end: input.source.end },
        requiresReview: true,
        correctionKind: "extraction_revision",
        notAUserDecisionChange: true,
      };
      await tx(owner, ws, async (c) => {
        const updated = await c.query(
          "UPDATE curation_reprocesses SET status='ready',candidate=$3,lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND run_id=$4 AND status='running'",
          [ws, task.request.id, JSON.stringify(candidate), task.runId],
        );
        if (!updated.rowCount) throw new ModelError("REPROCESS_LEASE_LOST");
        await c.query(
          "UPDATE refinement_runs SET status='completed',output=$3,usage=$4,diagnostics=diagnostics||$5::jsonb,finished_at=now() WHERE workspace_id=$1 AND id=$2",
          [
            ws,
            task.runId,
            JSON.stringify(response!.output),
            JSON.stringify(response!.usage),
            JSON.stringify({
              ...diag,
              stage: "candidate",
              inputVersion: CURATION_INPUT_VERSION,
            }),
          ],
        );
      });
    } catch (e) {
      const code =
        e instanceof ModelError
          ? e.code
          : e instanceof AppError
            ? e.code
            : e instanceof z.ZodError
              ? "AI_INVALID_OUTPUT"
              : "REPROCESS_FAILED";
      if (code === "AI_FREE_QUOTA_EXHAUSTED")
        await stopForQuota(owner, ws, task.settingsVersion);
      if (e instanceof z.ZodError)
        diag.schemaIssues = e.issues
          .map((i) => ({ path: i.path, code: i.code }))
          .slice(0, 20);
      await tx(owner, ws, async (c) => {
        await c.query(
          "UPDATE curation_reprocesses SET status='failed',error_code=$3,lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND run_id=$4",
          [ws, task.request.id, code, task.runId],
        );
        await c.query(
          "UPDATE refinement_runs SET status='failed',error_code=$3,output=$4,usage=$5,diagnostics=diagnostics||$6::jsonb,finished_at=now() WHERE workspace_id=$1 AND id=$2",
          [
            ws,
            task.runId,
            code,
            JSON.stringify(response?.output ?? null),
            JSON.stringify(response?.usage ?? reportedUsage ?? null),
            JSON.stringify(diag),
          ],
        );
      });
    }
    return true;
  }
  return false;
}
