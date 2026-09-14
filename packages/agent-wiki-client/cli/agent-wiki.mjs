#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp, open } from "node:fs/promises";
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
        "collector enable|disable --client codex|claude",
        "recall --project NAME",
        'search "question" [--tag TAG --view current|history --scope SCOPE]',
        'query search "keywords" [--view current|history|overview --scope SCOPE --limit N --trace ID]',
        "query claim ID --revision N --anchor ANCHOR [--depth 1 --trace ID]",
        "query source ID --start N --end N [--trace ID] | query trace ID | query traces",
        "source add FILE [--kind conversation|document|code|note] [--origin LOCATION]",
        "source get ID [--start N --end N]",
        "publish FILE.json",
        "publication status KEY",
        "pages [query] | page ID [--revision N]",
        "ai show | update FILE.json [--key-env ENV_NAME] | test [FILE.json] [--key-env ENV_NAME] [--fallback] | pause | resume",
        "api GET|POST|PUT|PATCH|DELETE /workspace-path [--file FILE.json] [--idempotency-key KEY] [--secret-output FILE]",
        "workspace list | create NAME",
        "article ID [--revision N]",
        "skill install [--client codex|claude|all]",
        "review queue [--page N] | diff ID [--revision N] | confirm ID --revision N --snapshot HASH --client codex|claude [--reason TEXT]",
        "relation reject --from ID/REVISION/ANCHOR --to ID/REVISION/ANCHOR --relation supersedes|retracts|contradicts|supports --client NAME --reason TEXT",
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
  async function request(
    path,
    { method = "GET", body, key, root = base } = {},
  ) {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    let failure;
    const attempts =
      method === "GET" || (path === "/publications" && key) ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const r = await fetch(root + path, {
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
        if (
          ![429, 502, 503, 504].includes(r.status) ||
          attempt === attempts - 1
        )
          throw e;
        failure = e;
      } catch (e) {
        if (e.status && ![429, 502, 503, 504].includes(e.status)) throw e;
        failure = e;
        if (attempt === attempts - 1) throw e;
      }
      await delay(300 * 2 ** attempt + Math.random() * 150);
    }
    throw failure;
  }
  if (command === "workspace") {
    const action = args.shift();
    if (action !== "list" && action !== "create")
      throw new Error("Use workspace list|create NAME");
    if (action === "create" && !args[0])
      throw new Error("Workspace name required");
    return output(
      await request("", {
        root: connection.server + "/api/workspaces",
        method: action === "list" ? "GET" : "POST",
        body: action === "create" ? { name: args[0] } : undefined,
      }),
    );
  }
  if (command === "api") {
    const method = args.shift()?.toUpperCase(),
      path = args.shift();
    if (
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ||
      !path ||
      !/^\/[a-zA-Z0-9][a-zA-Z0-9/_?=&.,:-]*$/.test(path) ||
      path.includes("..")
    )
      throw new Error(
        "Use a Workspace-relative API path and an explicit HTTP method",
      );
    const file = option("file"),
      secretFile = option("secret-output");
    if (method === "POST" && path === "/keys" && !secretFile)
      throw new Error(
        "Key creation requires --secret-output FILE (0600); secrets are never printed",
      );
    const secretHandle = secretFile
      ? await open(resolve(secretFile), "wx", 0o600)
      : null;
    try {
      const result = await request(path, {
        method,
        key: option("idempotency-key"),
        body: file ? await jsonFile(file) : method === "GET" ? undefined : {},
      });
      if (secretHandle) {
        await secretHandle.writeFile(JSON.stringify(result, null, 2) + "\n");
        return output({ saved: resolve(secretFile) });
      }
      return output(result);
    } finally {
      await secretHandle?.close();
    }
  }

  if (command === "ai") {
    const action = args.shift();
    if (!["show", "update", "test", "pause", "resume"].includes(action))
      throw new Error("Use ai show|update|test|pause|resume");
    const settings = await request("/ai-settings");
    if (action === "show") return output(settings);
    if (action === "pause" || action === "resume")
      return output(
        await request("/ai-settings/enabled", {
          method: "PATCH",
          body: { enabled: action === "resume", version: settings.version },
        }),
      );
    const keyEnv = option("key-env"),
      file = args[0];
    if (action === "update" && !file)
      throw new Error("AI configuration JSON file required");
    const patch = file ? await jsonFile(file) : {};
    if ("enabled" in patch)
      throw new Error("Use ai pause or ai resume separately");
    const {
      hasKey,
      version,
      stoppedReason,
      stoppedAt,
      fallbackActive,
      fallbackActiveSince,
      activeModel,
      ...config
    } = settings;
    const apiKey = keyEnv ? process.env[keyEnv] : undefined;
    if (keyEnv && !apiKey)
      throw new Error("Requested API key environment variable is empty");
    // primary/fallback are per-model-slot objects: merge into the existing
    // slot instead of the flat shallow merge below, so a patch naming only
    // one field (e.g. {"primary":{"reasoning":"high"}}) does not drop the
    // slot's other saved fields. {"fallback":null} clears the second model.
    const { primary: primaryPatch, fallback: fallbackPatch, ...sharedPatch } =
      patch;
    const mergedPrimary = primaryPatch
      ? { ...config.primary, ...primaryPatch }
      : config.primary;
    const mergedFallback = !("fallback" in patch)
      ? config.fallback
      : fallbackPatch === null
        ? null
        : { ...(config.fallback ?? {}), ...fallbackPatch };
    return output(
      await request("/ai-settings" + (action === "test" ? "/test" : ""), {
        method: action === "test" ? "POST" : "PUT",
        body: {
          version,
          config: {
            ...config,
            ...sharedPatch,
            primary: mergedPrimary,
            fallback: mergedFallback,
            enabled: config.enabled,
          },
          ...(apiKey ? { apiKey } : {}),
          ...(action === "test" && args.includes("--fallback")
            ? { target: "fallback" }
            : {}),
        },
      }),
    );
  }
  if (command === "reassemble")
    return output(
      await request("/wiki-pages/reassemble", { method: "POST", body: {} }),
    );
  if (command === "reprocess") {
    const action = args.shift(),
      id = args[0];
    if (action === "plan")
      return output(await request("/curation/reprocess/plan/" + id));
    if (action === "show")
      return output(await request("/curation/reprocess/" + id));
    if (action === "enqueue")
      return output(
        await request("/curation/reprocess", {
          method: "POST",
          body: await jsonFile(id),
        }),
      );
    if (action === "apply")
      return output(
        await request("/curation/reprocess/" + id + "/apply", {
          method: "POST",
          body: await jsonFile(args[1]),
        }),
      );
    throw new Error(
      "Use reprocess plan RUN_ID|enqueue FILE|show ID|apply ID FILE",
    );
  }
  if (command === "pages")
    return output(
      await request(
        "/wiki-pages?" +
          new URLSearchParams({
            q: args[0] ?? "",
            page: option("page", "1"),
            pageSize: option("page-size", "25"),
          }),
      ),
    );
  if (command === "page") {
    if (!args[0]) throw new Error("Wiki Page ID required");
    const revision = option("revision");
    return output(
      await request(
        "/wiki-pages/" + args[0] + (revision ? "/revisions/" + revision : ""),
      ),
    );
  }
  const tag = option("tag", connection.tag);
  if (command === "recall")
    return output(await request("/recall?" + new URLSearchParams({ tag })));
  if (command === "query") {
    const action = args.shift(),
      id = args[0];
    const fields = {};
    for (const [flag, name] of [
      ["trace", "traceId"],
      ["view", "view"],
      ["scope", "scope"],
      ["tag", "tag"],
      ["limit", "limit"],
      ["revision", "revision"],
      ["anchor", "anchor"],
      ["depth", "depth"],
      ["start", "start"],
      ["end", "end"],
    ]) {
      const value = option(flag);
      if (value) fields[name] = value;
    }
    if (action === "traces") return output(await request("/query/traces"));
    if (!id) throw new Error("Query text or ID required");
    let path;
    if (action === "search") {
      fields.q = id;
      path = "/query";
    } else if (["claim", "source", "trace"].includes(action)) {
      if (action === "claim" && (!fields.revision || !fields.anchor))
        throw new Error("--revision and --anchor required");
      if (action === "source" && (!fields.start || !fields.end))
        throw new Error("--start and --end required");
      path =
        "/query/" +
        { claim: "claims", source: "sources", trace: "traces" }[action] +
        "/" +
        encodeURIComponent(id);
    } else throw new Error("query search|claim|source|trace");
    if (action !== "trace") fields.traceId ??= randomUUID();
    try {
      return output(await request(path + "?" + new URLSearchParams(fields)));
    } catch (error) {
      throw new Error(
        String(error.message) +
          (fields.traceId ? " · traceId=" + fields.traceId : ""),
      );
    }
  }
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
            ...(option("tag") ? { tag: option("tag") } : {}),
            view,
            ...(scope ? { scope } : {}),
          }),
      ),
    );
  }
  if (command === "review") {
    const action = args.shift(),
      id = args[0];
    if (action === "queue")
      return output(
        await request(
          "/reviews?" +
            new URLSearchParams({
              page: option("page", "1"),
              pageSize: option("page-size", "25"),
            }),
        ),
      );
    if (!id) throw new Error("Knowledge ID required");
    if (action === "diff") {
      const revision = option("revision");
      return output(
        await request(
          "/articles/" +
            encodeURIComponent(id) +
            "/comparison" +
            (revision ? "?revision=" + encodeURIComponent(revision) : ""),
        ),
      );
    }
    if (action === "confirm") {
      const revision = Number(option("revision")),
        snapshotHash = option("snapshot"),
        client = option("client");
      if (
        !Number.isInteger(revision) ||
        revision < 1 ||
        !snapshotHash ||
        !client
      )
        throw new Error(
          "--revision, --snapshot and --client are required; read review diff and get the user's confirmation first",
        );
      return output(
        await request("/articles/" + encodeURIComponent(id) + "/review", {
          method: "POST",
          body: {
            revision,
            snapshotHash,
            client,
            reason: option("reason", ""),
          },
        }),
      );
    }
    throw new Error("Use review queue|diff|confirm");
  }
  if (command === "relation") {
    const action = args.shift();
    if (action !== "reject") throw new Error("Use relation reject");
    const parseRef = (name) => {
      const raw = option(name);
      if (!raw) throw new Error("--" + name + " is required");
      const [id, revision, anchor] = raw.split("/");
      if (!id || !revision || !/^\d+$/.test(revision) || !anchor)
        throw new Error("--" + name + " must be ID/REVISION/ANCHOR");
      return { articleId: id, revision: Number(revision), anchor };
    };
    const from = parseRef("from"),
      to = parseRef("to"),
      relation = option("relation"),
      client = option("client"),
      reason = option("reason");
    if (
      !["supersedes", "retracts", "contradicts", "supports"].includes(
        relation,
      )
    )
      throw new Error(
        "--relation must be supersedes, retracts, contradicts or supports",
      );
    if (!client || !reason)
      throw new Error("--client and --reason are required");
    return output(
      await request("/claim-relations/reject", {
        method: "POST",
        body: { from, to, relation, client, reason },
      }),
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
