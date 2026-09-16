import pg from "pg";
import { readFile } from "node:fs/promises";
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Database URL required");
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("BEGIN");
  // The whole file runs in one transaction, so every lock it takes is held
  // until COMMIT. A deploy carrying no schema change once consumed the Job's
  // 180s deadline waiting behind an active Worker write and rolled back. Fail
  // fast and say so instead: the statements below are guarded to be no-ops
  // when the schema already matches, so a wait here means real contention.
  await db.query("SET lock_timeout='15s'");
  await db.query("SELECT pg_advisory_xact_lock(821907)");
  await db.query(
    "CREATE TABLE IF NOT EXISTS wiki_schema_version(version int PRIMARY KEY)",
  );
  const version = await db.query(
    "SELECT version FROM wiki_schema_version WHERE version=2",
  );
  if (!version.rowCount) {
    // One-time, user-authorized development reset. Preserve login, Workspace,
    // infrastructure, monitoring and Object Storage checkpoints.
    await db.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
    await db.query(
      "DROP TABLE IF EXISTS project_contexts,evidence,claims,links,revisions,articles,sources,publications,api_keys CASCADE",
    );
    await db.query("INSERT INTO wiki_schema_version VALUES(2)");
  }
  await db.query(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  await db.query("REVOKE ALL ON wiki_schema_version FROM wiki_app, wiki_admin");
  await db.query("COMMIT");
  console.log("Migration complete: agent-curated schema v2");
} catch (e) {
  await db.query("ROLLBACK");
  if ((e as { code?: string }).code === "55P03")
    throw new Error(
      "Migration timed out waiting for a lock. A writer (usually the Worker) holds it; " +
        "pause curation or retry once it is idle.",
      { cause: e },
    );
  throw e;
} finally {
  await db.end();
}
