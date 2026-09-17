import pg from "pg"; import { readFileSync } from "node:fs";
const cfg = { host: process.env.PG_ADMIN_HOST, port: Number(process.env.PG_ADMIN_PORT||5432), database: process.env.PG_ADMIN_DATABASE, user: process.env.PG_ADMIN_USER, password: process.env.PG_ADMIN_PASSWORD, ssl: { ca: readFileSync(process.env.PG_ADMIN_SSLROOTCERT) } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 90; i++) {
  const c = new pg.Client(cfg); await c.connect(); await c.query("SET default_transaction_read_only=on");
  const j = (await c.query(`SELECT status,count(*)::int n FROM refinement_jobs GROUP BY 1`)).rows;
  const open = j.filter(r=>["pending","running"].includes(r.status)).reduce((n,r)=>n+r.n,0);
  const cl = (await c.query(`SELECT count(*)::int n FROM claims WHERE state='current'`)).rows[0].n;
  const calls = (await c.query(`SELECT count(*)::int n FROM refinement_runs WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`)).rows[0].n;
  await c.end();
  console.log(new Date().toISOString().slice(11,19), JSON.stringify(j), "current", cl, "calls", calls);
  if (!open) { console.log("QUEUE DRAINED"); break; }
  await sleep(120000);
}
