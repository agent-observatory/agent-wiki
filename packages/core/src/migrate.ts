import pg from "pg";
import { readFile } from "node:fs/promises";
import { PgBoss } from "pg-boss";
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Database URL required");
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(821907)");
  await db.query(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  await db.query("COMMIT");
} finally {
  await db.end();
}
const boss = new PgBoss({ connectionString: url, max: 2 });
await boss.start();
await boss.createQueue("ingest", {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 180,
  retentionSeconds: 365 * 86400,
  deleteAfterSeconds: 7 * 86400,
});
await boss.stop();
const grants = new pg.Client({ connectionString: url });
await grants.connect();
await grants.query(
  "GRANT USAGE ON SCHEMA pgboss TO wiki_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pgboss TO wiki_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO wiki_app;",
);
await grants.end();
console.log("Migration complete");
