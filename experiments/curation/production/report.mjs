import { createHash } from "node:crypto";
export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function sourceDigest(sources) {
  return digest(
    sources
      .map((s) => [s.id, s.content_hash, s.line_count])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}
function total(runs, path) {
  const values = runs.map((r) => path.reduce((v, k) => v?.[k], r.usage));
  const known = values.filter((v) => Number.isFinite(v) && v >= 0);
  return {
    reported: known.reduce((a, b) => a + b, 0),
    reportedCalls: known.length,
    unreportedCalls: values.length - known.length,
  };
}
export function compare(before, after) {
  if (before.workspace !== after.workspace)
    throw new Error("WORKSPACE_MISMATCH");
  if (before.casesHash !== after.casesHash)
    throw new Error("EVALUATION_CASES_CHANGED");
  const oldIds = new Set(before.runs.map((r) => r.id));
  const executions = after.runs.filter((r) => !oldIds.has(r.id));
  const calls = executions.filter((r) => r.diagnostics?.requestedAt);
  const oldSources = new Map(before.sources.map((s) => [s.id, s.content_hash]));
  const newSources = new Map(after.sources.map((s) => [s.id, s.content_hash]));
  const added = after.sources.filter((s) => !oldSources.has(s.id)).length;
  const removed = before.sources.filter((s) => !newSources.has(s.id)).length;
  const changed = after.sources.filter(
    (s) => oldSources.has(s.id) && oldSources.get(s.id) !== s.content_hash,
  ).length;
  const count = (key, rows = calls) =>
    Object.fromEntries(
      [...new Set(rows.map(key))].map((k) => [
        k,
        rows.filter((r) => key(r) === k).length,
      ]),
    );
  const retryCalls = calls.filter((r) => (r.diagnostics.attempt ?? 1) > 1);
  const usage = (rows) => ({
    input: total(rows, ["prompt_tokens"]),
    output: total(rows, ["completion_tokens"]),
    cachedInput: total(rows, ["prompt_tokens_details", "cached_tokens"]),
    reasoningOutput: total(rows, [
      "completion_tokens_details",
      "reasoning_tokens",
    ]),
  });
  const durations = calls
    .map((r) => r.diagnostics.durationMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const baselineJobs = after.jobs.filter((j) => oldSources.has(j.source_id));
  return {
    schema: 1,
    from: before.capturedAt,
    to: after.capturedAt,
    sourceComparison: {
      sameInputs: !added && !removed && !changed,
      added,
      removed,
      changed,
      beforeHash: sourceDigest(before.sources),
      afterHash: sourceDigest(after.sources),
    },
    settingsChanged: digest(before.settings) !== digest(after.settings),
    models: count((r) => r.settings.model ?? "unreported"),
    prompts: count((r) => r.prompt_version),
    executions: executions.length,
    modelCalls: calls.length,
    callStatus: count((r) => r.status),
    errors: count(
      (r) => r.error_code ?? "none",
      executions.filter((r) => r.error_code),
    ),
    failureStages: count(
      (r) => r.diagnostics?.stage ?? "unreported",
      executions.filter((r) => r.error_code),
    ),
    retries: retryCalls.length,
    usage: usage(calls),
    retryUsage: usage(retryCalls),
    durationMs: {
      reported: durations.length,
      median: durations.length
        ? durations[Math.floor((durations.length - 1) * 0.5)]
        : null,
      p95: durations.length
        ? durations[Math.ceil(durations.length * 0.95) - 1]
        : null,
    },
    baselineSourceProgress: count((j) => j.status, baselineJobs),
    knowledge: {
      articles: after.articles.filter((a) => !a.deleted_at).length,
      revisions: after.revisions.length,
      claims: after.claims.length,
      relations: after.relations.length,
    },
    quality:
      "NOT_SCORED: inspect frozen source evidence, stored claims/relations and query results; counts do not establish quality",
    limits: [
      "Cache is part of input; reasoning is part of output. Do not sum these four numbers.",
      "Missing usage is unknown, not zero. Retry usage may include useful work after an earlier failure.",
      "New source increments invalidate a strict same-input comparison. This capture does not restrict the production queue.",
      "This is an observational production baseline; human review remains separate.",
    ],
  };
}
