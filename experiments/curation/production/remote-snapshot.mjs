// Executed inside the existing API Pod by capture.mjs. No model import or mutation.
import { pool } from "./dist/packages/core/src/db.js";
import { getSources, hash } from "./dist/packages/core/src/storage.js";
import { sourceRoles } from "./dist/packages/core/src/source-roles.js";
import { curationInput } from "./dist/packages/core/src/curation-input.js";

export async function snapshot(request) {
  const c = await pool.connect();
  let sources;
  let result;
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await c.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
      [process.env.OWNER_GITHUB_ID, request.workspace],
    );
    const rows = async (sql) => (await c.query(sql, [request.workspace])).rows;
    const settings = (
      await rows("SELECT config,version FROM ai_settings WHERE workspace_id=$1")
    )[0];
    if (!settings || settings.config.enabled)
      throw new Error("CURATION_MUST_BE_PAUSED");
    const jobs = await rows(
      "SELECT id,source_id,generation,status,attempts,chunk_index,chunk_count,input_sources,cycle_id,batch_parent,error_code,available_at,updated_at FROM refinement_jobs WHERE workspace_id=$1 ORDER BY id",
    );
    if (jobs.some((j) => j.status === "running"))
      throw new Error("WAIT_FOR_RUNNING_JOBS");
    sources = await rows(
      "SELECT id,origin,kind,content_hash,line_count,created_at,object_key,metadata FROM sources WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at,id",
    );
    const safeSettings = (value) =>
      Object.fromEntries(
        [
          "model",
          "provider",
          "enabled",
          "maxInputTokens",
          "maxTokens",
          "maxInputChars",
          "reasoning",
          "enable_thinking",
          "thinking_budget",
          "max_completion_tokens",
          "requestsPerMinute",
          "concurrency",
          "retryDelaySeconds",
          "dailyCalls",
          "version",
        ]
          .filter((k) => k in value)
          .map((k) => [k, value[k]]),
      );
    const runs = await rows(
      "SELECT id,job_id,settings,prompt_version,chunk_index,status,error_code,usage,diagnostics,output,(input - 'source' - 'reference') || jsonb_build_object('source',COALESCE(input->'source','{}'::jsonb)-'text','reference',COALESCE(input->'reference','{}'::jsonb)-'text') AS input_references,created_at,finished_at FROM refinement_runs WHERE workspace_id=$1 ORDER BY created_at,id",
    );
    result = {
      schema: 1,
      capturedAt: (await c.query("SELECT transaction_timestamp() AS at"))
        .rows[0].at,
      workspace: request.workspace,
      deployedImage: process.env.IMAGE_TAG ?? null,
      settings: safeSettings({ ...settings.config, version: settings.version }),
      sources: sources.map(({ object_key, metadata, ...s }) => ({
        ...s,
        partIndex: metadata?.partIndex ?? null,
      })),
      jobs,
      runs: runs.map((r) => ({ ...r, settings: safeSettings(r.settings) })),
      events: (
        await rows(
          "SELECT count(*)::int AS count FROM collection_events WHERE workspace_id=$1",
        )
      )[0].count,
      articles: await rows("SELECT * FROM articles WHERE workspace_id=$1"),
      revisions: await rows("SELECT * FROM revisions WHERE workspace_id=$1"),
      reviews: await rows(
        "SELECT * FROM knowledge_reviews WHERE workspace_id=$1",
      ),
      claims: await rows("SELECT * FROM claims WHERE workspace_id=$1"),
      evidence: await rows("SELECT * FROM evidence WHERE workspace_id=$1"),
      relations: await rows(
        "SELECT * FROM claim_relations WHERE workspace_id=$1",
      ),
      links: await rows("SELECT * FROM links WHERE workspace_id=$1"),
      publications: await rows(
        "SELECT * FROM publications WHERE workspace_id=$1",
      ),
      contexts: await rows(
        "SELECT * FROM project_contexts WHERE workspace_id=$1",
      ),
    };
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  if (request.scanEvidence) {
    result.anchorCandidates = Object.fromEntries(
      request.cases.map((x) => [x.id, []]),
    );
    result.inputInventory = {
      originalBytes: 0,
      projectedBytes: 0,
      userRows: 0,
      assistantRows: 0,
      toolRows: 0,
      unknownRows: 0,
    };
    // Group one upload at a time so its compressed source is read once.
    const groups = new Map();
    for (const s of sources) {
      const key = s.metadata?.rawUploadId ?? s.id;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    let scanned = 0;
    for (const group of groups.values()) {
      const texts = await getSources(group.map((s) => s.object_key));
      for (let n = 0; n < group.length; n++) {
        const source = group[n],
          text = texts[n];
        if (hash(text) !== source.content_hash)
          throw new Error("SOURCE_HASH_MISMATCH");
        const roles = sourceRoles(text),
          lines = text.split("\n");
        const projected = curationInput(text);
        result.inputInventory.originalBytes += Buffer.byteLength(text);
        result.inputInventory.projectedBytes += Buffer.byteLength(
          projected.text,
        );
        for (let i = 0; i < lines.length; i++) {
          const role = roles[i] ?? "unknown";
          result.inputInventory[role + "Rows"]++;
          if (role !== "user") continue;
          let row;
          try {
            row = JSON.parse(lines[i]);
          } catch {
            continue;
          }
          if (typeof row.text !== "string") continue;
          for (const entry of request.cases) {
            const hits = entry.find.filter((phrase) =>
              row.text.toLowerCase().includes(phrase.toLowerCase()),
            );
            if (!hits.length || result.anchorCandidates[entry.id].length >= 12)
              continue;
            result.anchorCandidates[entry.id].push({
              sourceId: source.id,
              hash: source.content_hash,
              revision: 1,
              line: i + 1,
              event: row.event,
              field: row.field,
              role,
              quote: row.text,
              matched: hits,
            });
          }
        }
      }
      scanned += group.length;
      process.stderr.write(
        JSON.stringify({ scanned, total: sources.length }) + "\n",
      );
    }
  }
  return result;
}
