import type { PoolClient } from "pg";

// Read aggregate diagnostics only; never return prompts, outputs, or credentials.
export async function refinementHealth(c: PoolClient, ws: string) {
  const models = (
    await c.query(
      `
    SELECT settings->>'provider' AS provider,settings->>'model' AS model,
      count(*) FILTER (WHERE diagnostics ? 'requestedAt')::int AS attempts,
      count(*) FILTER (WHERE NOT diagnostics ? 'version')::int AS unmeasured,
      count(*) FILTER (WHERE diagnostics ? 'requestedAt' AND status='completed')::int AS completed,
      count(*) FILTER (WHERE diagnostics ? 'requestedAt' AND status IN ('failed','interrupted'))::int AS failed,
      count(*) FILTER (WHERE diagnostics ? 'requestedAt' AND status='running')::int AS running,
      count(*) FILTER (WHERE (diagnostics->>'attempt')::int>1 AND diagnostics ? 'requestedAt')::int AS retries,
      COALESCE(sum((diagnostics->>'httpRequests')::int),0)::int AS requests,
      round(avg((diagnostics->>'durationMs')::numeric))::int AS average_ms,
      (percentile_cont(0.95) WITHIN GROUP (ORDER BY (diagnostics->>'durationMs')::float8))::int AS p95_ms
    FROM refinement_runs WHERE workspace_id=$1 AND created_at>=now()-interval '7 days'
    GROUP BY settings->>'provider',settings->>'model' ORDER BY attempts DESC,model
  `,
      [ws],
    )
  ).rows;
  const errors = (
    await c.query(
      `
    SELECT settings->>'provider' AS provider,settings->>'model' AS model,
      error_code,COALESCE(diagnostics->>'stage','unknown') AS stage,
      count(*)::int AS count,min(created_at) AS first_seen,max(created_at) AS last_seen
    FROM refinement_runs WHERE workspace_id=$1 AND created_at>=now()-interval '7 days'
      AND error_code IS NOT NULL
    GROUP BY settings->>'provider',settings->>'model',error_code,diagnostics->>'stage'
    ORDER BY count DESC,last_seen DESC LIMIT 10
  `,
      [ws],
    )
  ).rows;
  const daily = (
    await c.query(
      `
    SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE diagnostics ? 'requestedAt')::int AS attempts,
      count(*) FILTER (WHERE diagnostics ? 'requestedAt' AND status='completed')::int AS completed,
      count(*) FILTER (WHERE diagnostics ? 'requestedAt' AND status IN ('failed','interrupted'))::int AS failed
    FROM refinement_runs WHERE workspace_id=$1 AND created_at>=now()-interval '7 days'
    GROUP BY day ORDER BY day DESC
  `,
      [ws],
    )
  ).rows;
  return { days: 7, models, errors, daily };
}
