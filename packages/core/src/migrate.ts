import pg from "pg";
import { readFile } from "node:fs/promises";
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Database URL required");
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("BEGIN");
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
  throw e;
} finally {
  await db.end();
}
