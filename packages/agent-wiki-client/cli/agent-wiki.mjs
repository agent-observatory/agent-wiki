#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  readConfig,
  writeConfig,
  defaultConfigPath,
  loadToken,
  validateServer,
} from "../config.mjs";
import { collectorMain, collectionInterval } from "../collector/collector.mjs";
import { homedir } from "node:os";
const args = process.argv.slice(2);
const command = args.shift();
function option(name, fallback) {
  const i = args.indexOf("--" + name);
  if (i === -1) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith("--"))
    throw new Error("Missing --" + name);
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}
const configPath = resolve(option("config", defaultConfigPath()));
const jsonFile = async (p) => JSON.parse(await readFile(p, "utf8"));
const output = (x) => process.stdout.write(JSON.stringify(x, null, 2) + "\n");
function skillClient() {
  const client = option("client", "codex");
  if (!["codex", "claude", "all"].includes(client))
    throw new Error("--client must be codex, claude or all");
  return client;
}
async function installSkill(force, client) {
  const roots =
    client === "all"
      ? [".agents", ".claude"]
      : [client === "claude" ? ".claude" : ".agents"];
  const targets = [];
  for (const root of roots) {
    const target = resolve(root, "skills/agent-wiki");
    await mkdir(target, { recursive: true });
    await cp(fileURLToPath(new URL("../skill/", import.meta.url)), target, {
      recursive: true,
      force,
    });
    targets.push(target);
  }
  return targets;
}
async function main() {
  if (!command || command === "help" || command === "--help") {
    output({
      commands: [
        "setup --workspace ID [--project NAME --tag TAG --path PATH --interval MINUTES --env FILE --client codex|claude|all --no-skill]",
        "collector start [--interval MINUTES] | stop | status | run",
        "recall --project NAME",
        'search "question" [--tag TAG --view current|history --scope SCOPE]',
        "source add FILE [--kind conversation|document|code|note] [--origin LOCATION]",
        "source get ID [--start N --end N]",
        "publish FILE.json",
        "publication status KEY",
        "article ID [--revision N]",
        "skill install [--client codex|claude|all]",
      ],
      configuration:
        "~/.agent-wiki/config.json; credentials in the configured env file",
    });
    return;
  }
  if (command === "collector")
    return collectorMain(args, configPath, fileURLToPath(import.meta.url));
  if (command === "setup") {
    const client = skillClient();
    let config = { version: 1, projects: {} };
    try {
      config = await readConfig(configPath);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const project = option(
      "project",
      config.defaultProject ?? basename(process.cwd()),
    );
    const previous = config.projects[project] ?? {};
    const workspace = option("workspace", previous.workspace);
    if (!/^[\da-f-]{36}$/.test(workspace ?? ""))
      throw new Error("Workspace UUID is required");
    const server = validateServer(
      option("server", previous.server ?? "https://agent-wiki.duckdns.org"),
    );
    const envFile = resolve(option("env", previous.envFile ?? ".env.local"));
    const tag = option("tag", previous.tag ?? project);
    const selectedPath = option("path");
    const all = args.includes("--all-projects");
    if (all && selectedPath) throw new Error("Choose --path or --all-projects");
    const oldCollector = config.collector ?? {};
    const destination = config.projects[oldCollector.connection];
    if (
      destination &&
      (destination.workspace !== workspace || destination.server !== server)
    )
      throw new Error(
        "Collector destination differs; use a separate --config for another Workspace",
      );
    config.defaultProject ??= project;
    config.projects[project] = { server, workspace, tag, envFile };
    config.collector = {
      ...oldCollector,
      connection: project,
      machine: oldCollector.machine ?? randomUUID(),
      name: oldCollector.name ?? "Agent Wiki",
      projects: selectedPath
        ? [resolve(selectedPath)]
        : all
          ? []
          : (oldCollector.projects ?? []),
      intervalMinutes: collectionInterval(
        option("interval", oldCollector.intervalMinutes ?? 10),
      ),
      exclude: oldCollector.exclude ?? [],
      roots: oldCollector.roots ?? [
        { client: "codex", path: join(homedir(), ".codex", "sessions") },
        { client: "claude", path: join(homedir(), ".claude", "projects") },
      ],
    };
    await writeConfig(configPath, config);
    if (!args.includes("--no-skill")) await installSkill(false, client);
    output({
      configured: project,
      config: configPath,
      collection: {
        projects: config.collector.projects.length
          ? config.collector.projects
          : "all",
        intervalMinutes: config.collector.intervalMinutes,
      },
      next: "agent-wiki collector start",
    });
    return;
  }
  if (command === "skill" && args[0] === "install") {
    const target = await installSkill(true, skillClient());
    output({
      installed: target,
      note: "필요한 지식을 조회할 때 사용합니다. 수집은 agent-wiki collector start로 별도 실행합니다.",
    });
    return;
  }
  const config = await readConfig(configPath);
  const project = option("project", config.defaultProject);
  const connection = config.projects[project];
  if (!connection)
    throw new Error("Project connection missing. Run agent-wiki setup.");
  validateServer(connection.server);
  const token = await loadToken(connection);
  const base = connection.server + "/api/workspaces/" + connection.workspace;
  async function request(path, { method = "GET", body, key } = {}) {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(base + path, {
          method,
          body: serialized,
          headers: {
            Authorization: "Bearer " + token,
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          signal: AbortSignal.timeout(25000),
          redirect: "error",
        });
        const data = await r.json();
        if (r.ok) return data;
        const e = new Error(data.error ?? "HTTP_" + r.status);
        e.status = r.status;
        if (![429, 502, 503, 504].includes(r.status) || attempt === 2) throw e;
        failure = e;
      } catch (e) {
        if (e.status && ![429, 502, 503, 504].includes(e.status)) throw e;
        failure = e;
        if (attempt === 2) throw e;
      }
      await delay(300 * 2 ** attempt + Math.random() * 150);
    }
    throw failure;
  }
  const tag = option("tag", connection.tag);
  if (command === "recall")
    return output(await request("/recall?" + new URLSearchParams({ tag })));
  if (command === "search") {
    const view = option("view", "current"),
      scope = option("scope");
    if (!["current", "history"].includes(view))
      throw new Error("--view must be current or history");
    if (!args[0]) throw new Error("Search question required");
    return output(
      await request(
        "/context?" +
          new URLSearchParams({
            q: args[0],
            tag,
            view,
            ...(scope ? { scope } : {}),
          }),
      ),
    );
  }
  if (command === "article") {
    const revision = option("revision");
    return output(
      await request(
        "/articles/" +
          encodeURIComponent(args[0]) +
          (revision ? "/revisions/" + encodeURIComponent(revision) : ""),
      ),
    );
  }
  if (command === "source") {
    const action = args.shift();
    if (action === "add") {
      const kind = option("kind", "document");
      const origin = option("origin", args[0]);
      const name = option("name", args[0]?.split("/").pop());
      const text = await readFile(args[0], "utf8");
      const body = { name, text, kind, origin };
      const key = option(
        "key",
        createHash("sha256").update(JSON.stringify(body)).digest("hex"),
      );
      return output(
        await request("/source-records", { method: "POST", body, key }),
      );
    }
    if (action === "get") {
      const start = option("start");
      const end = option("end");
      const query = new URLSearchParams();
      if (start) query.set("start", start);
      if (end) query.set("end", end);
      return output(
        await request(
          "/source-records/" +
            encodeURIComponent(args[0]) +
            "/revisions/1?" +
            query,
        ),
      );
    }
  }
  if (command === "publication" && args[0] === "status")
    return output(
      await request("/publications/" + encodeURIComponent(args[1])),
    );
  if (command === "publish") {
    const body = await jsonFile(args[0]);
    if (!body.idempotencyKey)
      throw new Error(
        "Persist idempotencyKey in the input JSON before publishing",
      );
    try {
      return output(
        await request("/publications", {
          method: "POST",
          body,
          key: body.idempotencyKey,
        }),
      );
    } catch (error) {
      if (!error.status || error.status >= 500) {
        try {
          return output(
            await request(
              "/publications/" + encodeURIComponent(body.idempotencyKey),
            ),
          );
        } catch {}
      }
      throw error;
    }
  }
  throw new Error("Unknown command. Run agent-wiki help.");
}
main().catch((e) => {
  process.stderr.write(
    JSON.stringify({ error: e.status ? e.message : (e.code ?? e.message) }) +
      "\n",
  );
  process.exitCode = 1;
});
