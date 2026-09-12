import { workerMain } from "./worker.js";
import { log } from "../../../packages/core/src/log.js";
workerMain().catch(() => {
  log("error", "worker_stopped_unexpectedly");
  process.exit(1);
});
