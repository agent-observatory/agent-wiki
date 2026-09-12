import { buildApp } from "./app.js";
import { pool } from "../../../packages/core/src/db.js";
import { log } from "../../../packages/core/src/log.js";
const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 3001) });
log("info", "api_started");
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    log("info", "api_draining");
    const timeout = setTimeout(() => {
      log("error", "api_drain_timeout");
      process.exit(1);
    }, 30000);
    timeout.unref();
    try {
      await app.close();
      await pool.end();
      log("info", "api_stopped");
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  });
