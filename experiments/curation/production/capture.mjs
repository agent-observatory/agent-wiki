#!/usr/bin/env node
import { readFile, writeFile, mkdir, chmod, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import {
  readConfig,
  defaultConfigPath,
  loadToken,
  validateServer,
} from "../../../packages/agent-wiki-client/config.mjs";
import { digest, sourceDigest, compare } from "./report.mjs";

// All remote work is SELECT/Object Storage GET/API GET. No resume/reset/model call.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = resolve(root, ".runtime/curation-evaluation");
const args = process.argv.slice(2),
  command = args.shift();
const option = (name, fallback) => {
  const i = args.indexOf("--" + name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) throw new Error("MISSING_OPTION");
  args.splice(i, 2);
  return v;
};
const project = option("project", null);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const save = async (name, value) => {
  await writeFile(resolve(dir, name), JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
};
const verified = async (label) => {
  const data = await readJson(resolve(dir, label + ".json"));
  const check = await readJson(resolve(dir, label + ".sha256.json"));
  if (digest(data) !== check.sha256)
    throw new Error("SNAPSHOT_CHECKSUM_MISMATCH");
  return data;
};
async function main() {
  if (!["prepare", "capture", "compare"].includes(command))
    throw new Error(
      "Usage: capture.mjs prepare LABEL | capture LABEL | compare BEFORE AFTER LABEL [--project NAME]",
    );
  if (args.some((x) => !/^[-a-zA-Z0-9_]+$/.test(x)))
    throw new Error("INVALID_LABEL");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  if (command === "compare") {
    if (args.length !== 3) throw new Error("THREE_LABELS_REQUIRED");
    const report = compare(await verified(args[0]), await verified(args[1]));
    await save(args[2] + ".json", report);
    console.log(
      JSON.stringify({
        saved: resolve(dir, args[2] + ".json"),
        calls: report.modelCalls,
        inputs: report.sourceComparison,
        quality: report.quality,
      }),
    );
    return;
  }
  if (args.length !== 1) throw new Error("ONE_LABEL_REQUIRED");
  try {
    await access(resolve(dir, args[0] + ".json"));
    throw new Error("LABEL_ALREADY_EXISTS");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const config = await readConfig(defaultConfigPath()),
    connection = config.projects[project ?? config.defaultProject];
  if (!connection) throw new Error("PROJECT_CONNECTION_MISSING");
  validateServer(connection.server);
  const cases = await readJson(
    resolve(root, "experiments/curation/production/cases.json"),
  );
  const ssh = await readJson(resolve(root, ".runtime/k3s-ssh.json"));
  if (!Array.isArray(ssh) || ssh[0] !== "ssh")
    throw new Error("INVALID_SSH_CONFIGURATION");
  const script = await readFile(
    resolve(root, "experiments/curation/production/remote-snapshot.mjs"),
    "utf8",
  );
  const request = {
    workspace: connection.workspace,
    scanEvidence: command === "prepare",
    cases: cases.cases,
  };
  if (request.scanEvidence) {
    const selectors = await readJson(resolve(dir, "selectors.json"));
    request.cases = cases.cases.map((entry) => {
      const find = selectors[entry.id];
      if (
        !Array.isArray(find) ||
        !find.length ||
        find.some((x) => typeof x !== "string" || !x.trim())
      )
        throw new Error("PRIVATE_SELECTORS_REQUIRED");
      return { ...entry, find };
    });
  }
  const remote = spawn(
    ssh[0],
    [
      ...ssh.slice(1),
      "sudo k3s kubectl -n agent-wiki exec -i deploy/agent-wiki-api -- node --input-type=module",
    ],
    { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  remote.stdout.setEncoding("utf8");
  remote.stderr.setEncoding("utf8");
  remote.stdout.on("data", (x) => {
    stdout += x;
  });
  remote.stderr.on("data", (x) => {
    stderr += x;
    for (const line of x.split("\n"))
      if (/^\{"scanned":/.test(line)) process.stderr.write(line + "\n");
  });
  remote.stdin.end(
    script +
      "\ntry { console.log(JSON.stringify(await snapshot(" +
      JSON.stringify(request) +
      "))); } catch(e) { console.error(e.code || e.message); process.exitCode=1; } finally { await pool.end(); }\n",
  );
  const code = await new Promise((ok, fail) => {
    remote.on("error", fail);
    remote.on("close", ok);
  });
  if (code !== 0)
    throw new Error(
      "REMOTE_SNAPSHOT_FAILED: " +
        (stderr.match(
          /CURATION_MUST_BE_PAUSED|WAIT_FOR_RUNNING_JOBS|SOURCE_HASH_MISMATCH/,
        )?.[0] ?? "inspect remote configuration"),
    );
  const data = JSON.parse(stdout);
  data.casesHash = digest(cases);
  data.captureToolHash = digest(
    script + (await readFile(fileURLToPath(import.meta.url), "utf8")),
  );
  data.sourceManifestHash = sourceDigest(data.sources);
  data.localCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  data.localDiffHash = digest(
    execFileSync("git", ["diff", "HEAD"], { cwd: root, encoding: "utf8" }),
  );
  data.evaluationCases = cases;
  data.queries = [];
  const token = await loadToken(connection);
  const get = async (path) => {
    const r = await fetch(
      connection.server + "/api/workspaces/" + connection.workspace + path,
      {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    );
    if (!r.ok) throw new Error("QUERY_CAPTURE_HTTP_" + r.status);
    return r.json();
  };
  for (const entry of cases.cases) {
    const result = await get(
      "/context?" + new URLSearchParams({ q: entry.query, view: entry.view }),
    );
    data.queries.push({
      caseId: entry.id,
      question: entry.question,
      query: entry.query,
      view: entry.view,
      result,
    });
  }
  // Abort rather than mark an actively changing knowledge capture complete.
  const ai = await get("/ai-settings");
  if (ai.enabled !== false) throw new Error("CURATION_CHANGED_DURING_CAPTURE");
  await save(args[0] + ".json", data);
  await save(args[0] + ".sha256.json", { sha256: digest(data) });
  await save(args[0] + ".scorecard.json", {
    snapshotHash: digest(data),
    casesHash: data.casesHash,
    productReviewConfirmed: false,
    cases: cases.cases.map((entry) => ({
      id: entry.id,
      split: entry.split,
      expected: entry.expected,
      verdict: "not_evaluated",
      sourceCoverage:
        "check jobs against accepted source anchors before grading",
      claimReferences: [],
      relationReferences: [],
      queryEvidence: [],
      failureStage: null,
      notes: "",
    })),
  });
  console.log(
    JSON.stringify({
      saved: resolve(dir, args[0] + ".json"),
      sources: data.sources.length,
      events: data.events,
      jobs: data.jobs.length,
      runs: data.runs.length,
      articles: data.articles.length,
      enabled: data.settings.enabled,
      anchors: data.anchorCandidates
        ? Object.fromEntries(
            Object.entries(data.anchorCandidates).map(([k, v]) => [
              k,
              v.length,
            ]),
          )
        : undefined,
    }),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
