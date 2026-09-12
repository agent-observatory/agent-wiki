import { PgBoss } from "pg-boss";
import { pool, tx } from "../../../packages/core/src/db.js";
import {
  processSource,
  ModelError,
  type IngestData,
} from "../../../packages/core/src/ingest.js";
import { log } from "../../../packages/core/src/log.js";
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  migrate: false,
  max: 2,
  schedule: false,
});
boss.on("error", () => log("error", "queue_connection_error"));
await boss.start();
const abort = new AbortController();
let closing = false;
await boss.work<
  IngestData,
  void,
  { batchSize: 1; includeMetadata: true; pollingIntervalSeconds: 5 }
>(
  "ingest",
  { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 5 },
  async (jobs) => {
    const job = jobs[0];
    try {
      await processSource(job.data, job.retryCount, abort.signal);
    } catch (error) {
      const code =
        error instanceof ModelError
          ? error.code
          : abort.signal.aborted
            ? "WORKER_SHUTDOWN"
            : "INGEST_ERROR";
      const terminal =
        (error instanceof ModelError && !error.retryable) ||
        job.retryCount >= job.retryLimit;
      await tx(job.data.userId, job.data.workspaceId, async (c) => {
        await c.query(
          "UPDATE sources SET status=$2,error_code=$3 WHERE id=$1 AND deleted_at IS NULL AND status<>'completed'",
          [job.data.sourceId, terminal ? "failed" : "retrying", code],
        );
      });
      log(
        terminal ? "error" : "warn",
        terminal ? "job_failed_terminal" : "job_retry",
        {
          job_id: job.data.sourceId,
          attempt: job.retryCount + 1,
          error_code: code,
          retryable: !terminal,
        },
      );
      if (terminal) {
        await pool.query(
          "UPDATE pgboss.job SET retry_limit=retry_count WHERE id=$1 AND name='ingest'",
          [job.id],
        );
        await boss.fail("ingest", job.id, { code });
        return;
      }
      if (error instanceof ModelError && error.retryAfter > 0) {
        // Respect provider delay without keeping a worker or transaction asleep.
        await tx(job.data.userId, job.data.workspaceId, async (c) => {
          await c.query(
            "UPDATE pgboss.job SET retry_delay=$2,retry_backoff=false WHERE id=$1 AND name='ingest'",
            [job.id, Math.max(30, Math.ceil(error.retryAfter))],
          );
        });
      }
      throw new Error(code);
    }
  },
);
log("info", "worker_started");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    log("info", "worker_draining");
    const deadline = setTimeout(
      () => abort.abort(new Error("SHUTDOWN_TIMEOUT")),
      80000,
    );
    const hard = setTimeout(() => process.exit(1), 90000);
    hard.unref();
    try {
      await boss.offWork("ingest", { wait: true });
      await boss.stop({ graceful: true, timeout: 85000 });
      await pool.end();
      log("info", "worker_stopped");
    } finally {
      clearTimeout(deadline);
      clearTimeout(hard);
    }
  });
