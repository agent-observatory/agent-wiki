import type { PoolClient } from "pg";

type Job = {
  id: string;
  source_id: string;
  name: string;
  session_key: string;
  status: string;
  error_code: string | null;
  batch_parent: string | null;
  cycle_id: string | null;
  cycle_started_at: Date | null;
  line_count: number;
  records: number;
  created_at: Date;
  updated_at: Date;
  source_created_at: Date;
  chunk_index: number;
  chunk_count: number;
  applied_lines: number;
  applying: boolean;
};

// Counts and coverage use DB metadata only; this path never opens raw objects.
export async function sessionProgress(c: PoolClient, ws: string) {
  const { rows } = await c.query<Job>(
    `WITH records AS (
       SELECT source_id,count(*)::int AS n FROM collection_events
       WHERE workspace_id=$1 GROUP BY source_id
     )
     SELECT j.id,j.source_id,j.status,j.error_code,j.batch_parent,j.cycle_id,
       j.cycle_started_at,j.created_at,j.updated_at,j.chunk_index,j.chunk_count,
       s.name,s.line_count,s.created_at AS source_created_at,
       CASE WHEN s.kind='conversation' AND s.origin<>'' THEN 'conversation:'||s.origin
         ELSE 'source:'||s.id::text END AS session_key,
       COALESCE(records.n,0)::int AS records,
       CASE WHEN j.chunk_index>0 THEN COALESCE((j.chunk_plan->'chunks'->(j.chunk_index-1)->>'end')::int,0)
         ELSE 0 END AS applied_lines,
       (j.output IS NOT NULL AND j.status='running') AS applying
     FROM refinement_jobs j JOIN sources s ON s.id=j.source_id AND s.workspace_id=j.workspace_id
     LEFT JOIN records ON records.source_id=s.id
     WHERE j.workspace_id=$1 AND s.deleted_at IS NULL
     ORDER BY s.created_at,s.id`,
    [ws],
  );
  return summarizeSessions(rows);
}

export function summarizeSessions(rows: Job[]) {
  const groups = new Map<string, Job[]>();
  for (const row of rows) {
    const group = groups.get(row.session_key) ?? [];
    group.push(row);
    groups.set(row.session_key, group);
  }
  return [...groups.values()]
    .map((jobs) => {
      const count = (status: string) =>
        jobs.filter((j) => j.status === status).length;
      const cycles = new Map<string, Job[]>();
      for (const job of jobs)
        if (job.cycle_id) {
          const members = cycles.get(job.cycle_id) ?? [];
          members.push(job);
          cycles.set(job.cycle_id, members);
        }
      const ordered = [...cycles.values()].sort(
        (a, b) =>
          new Date(a[0].cycle_started_at!).getTime() -
          new Date(b[0].cycle_started_at!).getTime(),
      );
      const finished = ordered.filter((members) =>
        members.every((j) => j.status === "completed"),
      );
      const active = ordered.find((members) =>
        members.some((j) => j.status !== "completed"),
      );
      const scope =
        active ??
        (jobs.every((j) => j.status === "completed")
          ? finished.at(-1)
          : undefined);
      const newest = (items: Job[], key: "updated_at" | "source_created_at") =>
        new Date(
          Math.max(...items.map((j) => new Date(j[key]).getTime())),
        ).toISOString();
      let percent: number | null = null;
      if (scope) {
        const batches = new Map<string, Job[]>();
        for (const j of scope) {
          const id = j.batch_parent ?? j.id;
          const members = batches.get(id) ?? [];
          members.push(j);
          batches.set(id, members);
        }
        let done = 0,
          total = 0;
        for (const [rootId, members] of batches) {
          const size = members.reduce((sum, j) => sum + j.line_count, 0);
          total += size;
          const root = members.find((j) => j.id === rootId);
          done += members.every((j) => j.status === "completed")
            ? size
            : Math.min(size, root?.applied_lines ?? 0);
        }
        // A successful extraction is not completion until its knowledge transaction commits.
        percent = active
          ? Math.min(99, total ? Math.floor((done / total) * 100) : 0)
          : 100;
      }
      const failed = count("failed"),
        running = count("running"),
        pending = count("pending");
      const retrying = jobs.filter(
        (j) => j.status === "pending" && j.error_code && !j.batch_parent,
      ).length;
      const applying = jobs.some((j) => j.applying);
      const state = failed
        ? "attention"
        : applying
          ? "applying"
          : running
            ? "curating"
            : retrying
              ? "retrying"
              : pending
                ? "waiting"
                : "current";
      return {
        id: jobs[0].source_id,
        name: jobs.at(-1)!.name,
        total: jobs.length,
        completed: count("completed"),
        pending,
        running,
        failed,
        retrying,
        state,
        percent,
        cycle_id: scope?.[0].cycle_id ?? null,
        cycle_started_at: scope?.[0].cycle_started_at ?? null,
        cycle_records: scope?.reduce((sum, j) => sum + j.records, 0) ?? 0,
        records: jobs.reduce((sum, j) => sum + j.records, 0),
        new_records: jobs
          .filter((j) => !j.cycle_id && j.status !== "completed")
          .reduce((sum, j) => sum + j.records, 0),
        waiting_inputs:
          jobs.filter((j) => !j.cycle_id && j.status !== "completed").length >
          0,
        has_previous: finished.length > 0,
        reflected_at: finished.length
          ? newest(finished.at(-1)!, "updated_at")
          : null,
        collected_at: newest(jobs, "source_created_at"),
        updated_at: newest(jobs, "updated_at"),
      };
    })
    .sort((a, b) => {
      const rank = (s: string) =>
        [
          "applying",
          "curating",
          "attention",
          "retrying",
          "waiting",
          "current",
        ].indexOf(s);
      return (
        rank(a.state) - rank(b.state) ||
        b.updated_at.localeCompare(a.updated_at) ||
        a.id.localeCompare(b.id)
      );
    });
}
