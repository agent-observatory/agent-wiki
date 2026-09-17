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
// `consolidate status TOPIC` renders the single-topic Job (full steps, not
// the counts-only list form) as text instead of a raw JSON dump.
function ref(r) {
  return r.articleId + "/" + r.revision + "/" + r.anchor;
}
// Shared by `relation reject`/`relation add`/`claim retire`/`claim assert`:
// ARTICLE_ID/REVISION/ANCHOR is how every command in this file names one
// claim Version, matching the query/article-detail JSON shape {articleId,
// revision, anchor}.
function parseClaimRef(name, raw) {
  if (!raw) throw new Error("--" + name + " is required");
  const [id, revision, anchor] = raw.split("/");
  if (!id || !revision || !/^\d+$/.test(revision) || !anchor)
    throw new Error("--" + name + " must be ID/REVISION/ANCHOR");
  return { articleId: id, revision: Number(revision), anchor };
}
// Same shape as parseClaimRef, for the one positional ARTICLE_ID/REVISION/
// ANCHOR argument `claim retire` takes instead of a --flag.
function parsePositionalRef(raw) {
  if (!raw) throw new Error("ARTICLE_ID/REVISION/ANCHOR required");
  const [id, revision, anchor] = raw.split("/");
  if (!id || !revision || !/^\d+$/.test(revision) || !anchor)
    throw new Error("Use ARTICLE_ID/REVISION/ANCHOR");
  return { articleId: id, revision: Number(revision), anchor };
}
// A one-line, size-bounded article title derived from free-form reason/text:
// used only as a display label, never compared against claim.text.
function noteTitle(text) {
  const line = String(text).split("\n")[0].trim();
  return (line.length > 197 ? line.slice(0, 197) + "..." : line) || "메모";
}
function printConflictsReview(topicKey, result) {
  const lines = ["주제: " + (topicKey || "전체")];
  lines.push("", "충돌 (" + result.conflicts.length + "):");
  for (const cf of result.conflicts) {
    lines.push("  " + cf.subject + "/" + cf.scope);
    for (const side of [cf.from, cf.to]) {
      lines.push("    " + ref(side) + " [" + side.state + "] " + side.text);
      for (const t of side.evidenceTimes)
        lines.push(
          "      evidence: " + t.recorded_at + " (" + t.time_kind + ")",
        );
    }
  }
  lines.push("", "통합 대기함 (" + result.inbox.length + "):");
  for (const item of result.inbox)
    lines.push(
      "  " +
        ref(item.from) +
        " --" +
        item.relation +
        "--> " +
        ref(item.to) +
        " [" +
        item.errorCode +
        "] " +
        item.createdAt,
    );
  lines.push("", "미해결 (" + result.leaveUnresolved.length + "):");
  for (const job of result.leaveUnresolved)
    for (const r of job.reasons)
      lines.push(
        "  Job " + job.jobId + " · " + r.subject + "/" + r.scope + ": " + r.reason,
      );
  process.stdout.write(lines.join("\n") + "\n");
}
function printConsolidationStatus(topicKey, result) {
  const job = result.job;
  const lines = ["주제: " + topicKey];
  if (!job) {
    lines.push("통합 Job 없음");
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }
  lines.push(
    "Job " +
      job.id +
      " · " +
      job.status +
      " · trigger=" +
      job.trigger +
      (job.attempt ? " · attempt=" + job.attempt : "") +
      (job.error_code ? " · error=" + job.error_code : ""),
  );
  const steps = job.steps ?? {};
  const modelOut = steps.model?.output;
  if (modelOut) {
    lines.push("", "model relations (" + (modelOut.relations?.length ?? 0) + "):");
    for (const r of modelOut.relations ?? [])
      lines.push("  " + ref(r.from) + " --" + r.relation + "--> " + ref(r.target));
    for (const u of modelOut.leaveUnresolved ?? [])
      lines.push("  leaveUnresolved " + u.subject + "/" + u.scope + ": " + u.reason);
  }
  const validateOut = steps.validate?.output;
  if (validateOut) {
    lines.push(
      "",
      "validate: passed=" +
        (validateOut.passed?.length ?? 0) +
        " rejected=" +
        (validateOut.rejected?.length ?? 0),
    );
    for (const rej of validateOut.rejected ?? [])
      lines.push(
        "  [" +
          rej.code +
          "] " +
          ref(rej.relation.from) +
          " --" +
          rej.relation.relation +
          "--> " +
          ref(rej.relation.target),
      );
  }
  const publishOut = steps.publish?.output;
  if (publishOut)
    lines.push(
      "",
      "publish: published=" +
        publishOut.published +
        " rejected=" +
        publishOut.rejected +
        " inboxResolved=" +
        publishOut.inboxResolved +
        (publishOut.publicationId ? " publicationId=" + publishOut.publicationId : ""),
    );
  process.stdout.write(lines.join("\n") + "\n");
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
        "review queue [--page N] | diff ID [--revision N] | confirm ID --revision N --snapshot HASH --client codex|claude [--reason TEXT] | conflicts [--topic KEY]",
        "relation reject --from ID/REVISION/ANCHOR --to ID/REVISION/ANCHOR --relation supersedes|retracts|contradicts|supports --client NAME --reason TEXT",
        "relation add --from ID/REVISION/ANCHOR --to ID/REVISION/ANCHOR --relation supersedes|retracts|contradicts|supports --client NAME --reason TEXT",
        "claim retire ID/REVISION/ANCHOR --reason TEXT",
        "claim assert --topic KEY --subject SLUG --scope SCOPE --text TEXT [--supersedes ID/REVISION/ANCHOR]",
        "consolidate TOPIC_KEY | consolidate --all | consolidate plan [TOPIC_KEY|--all] | consolidate status [TOPIC_KEY]",
        "curation queue [--source ID ...]",
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
  // Shared by `claim retire`/`claim assert`: the user's own words become a
  // tiny, immutable L1 source (kind=note, origin=feedback:<login>) before any
  // claim can cite them — every claim must be grounded in real evidence, and
  // this is the user's evidence. docs/l2-l3-memory.md.
  async function registerNote(name, text) {
    const me = await request("/me", { root: connection.server + "/api" });
    const origin = "feedback:" + me.user.login;
    const noted = text + "\n" + new Date().toISOString();
    const src = await request("/source-records", {
      method: "POST",
      body: { name, kind: "note", origin, text: noted },
      key: createHash("sha256")
        .update(JSON.stringify({ origin, text: noted }))
        .digest("hex"),
    });
    return {
      text: src.text,
      evidence: [
        {
          sourceId: src.id,
          revision: 1,
          lines: [1, src.lineCount],
          quote: src.text,
        },
      ],
    };
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
    if (action === "conflicts") {
      const topic = option("topic");
      const result = await request(
        "/review/conflicts" +
          (topic ? "?" + new URLSearchParams({ topic }) : ""),
      );
      return printConflictsReview(topic, result);
    }
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
    throw new Error("Use review queue|diff|confirm|conflicts");
  }
  if (command === "claim") {
    const action = args.shift();
    if (action !== "retire" && action !== "assert")
      throw new Error("Use claim retire|assert");
    if (action === "retire") {
      const target = parsePositionalRef(args[0]);
      const reason = option("reason");
      if (!reason) throw new Error("--reason is required");
      const targetArticle = await request(
        "/articles/" +
          encodeURIComponent(target.articleId) +
          "/revisions/" +
          target.revision,
      );
      const targetClaim = targetArticle.claims.find(
        (cl) => cl.anchor === target.anchor,
      );
      if (!targetClaim)
        throw new Error("Claim anchor not found on that revision");
      const note = await registerNote("철회 근거", reason);
      const idempotencyKey = randomUUID();
      return output(
        await request("/publications", {
          method: "POST",
          key: idempotencyKey,
          body: {
            idempotencyKey,
            producer: { type: "agent", client: "agent-wiki-cli" },
            reason: "사용자 철회 · " + reason,
            inputs: [
              { articleId: target.articleId, revision: target.revision },
            ],
            changes: [
              {
                clientRef: "retire",
                kind: "memory",
                // Without the target's topic the correction lands on
                // topic_key='', which no wiki page assembles and no
                // consolidation gathers: the user's fix would be invisible
                // exactly where the claim it replaces is read.
                ...(targetArticle.topic_key
                  ? {
                      topic: {
                        key: targetArticle.topic_key,
                        title: targetArticle.topic_title || targetArticle.title,
                      },
                    }
                  : {}),
                title: noteTitle(reason),
                content: note.text,
                claims: [
                  {
                    anchor: "decision",
                    text: note.text,
                    type: "user_decision",
                    subject: targetClaim.subject,
                    scope: targetClaim.scope,
                    state: "current",
                    evidence: note.evidence,
                  },
                ],
                claimRelations: [
                  {
                    anchor: "decision",
                    relation: "retracts",
                    target,
                    evidence: note.evidence,
                  },
                ],
              },
            ],
          },
        }),
      );
    }
    // action === "assert"
    const topicKey = option("topic"),
      subject = option("subject"),
      scope = option("scope"),
      text = option("text"),
      supersedesRaw = option("supersedes");
    if (!topicKey || !subject || !scope || !text)
      throw new Error(
        "--topic, --subject, --scope and --text are required",
      );
    const supersedes = supersedesRaw
      ? parseClaimRef("supersedes", supersedesRaw)
      : null;
    const note = await registerNote("사용자 결정 근거", text);
    const idempotencyKey = randomUUID();
    return output(
      await request("/publications", {
        method: "POST",
        key: idempotencyKey,
        body: {
          idempotencyKey,
          producer: { type: "agent", client: "agent-wiki-cli" },
          reason: "사용자 결정 · " + text,
          inputs: supersedes
            ? [{ articleId: supersedes.articleId, revision: supersedes.revision }]
            : [],
          changes: [
            {
              clientRef: "assert",
              kind: "memory",
              topic: { key: topicKey, title: topicKey },
              title: noteTitle(text),
              content: note.text,
              claims: [
                {
                  anchor: "decision",
                  text: note.text,
                  type: "user_decision",
                  subject,
                  scope,
                  state: "current",
                  evidence: note.evidence,
                },
              ],
              claimRelations: supersedes
                ? [
                    {
                      anchor: "decision",
                      relation: "supersedes",
                      target: supersedes,
                      evidence: note.evidence,
                    },
                  ]
                : [],
            },
          ],
        },
      }),
    );
  }
  if (command === "relation") {
    const action = args.shift();
    if (action !== "reject" && action !== "add")
      throw new Error("Use relation reject|add");
    const from = parseClaimRef("from", option("from")),
      to = parseClaimRef("to", option("to")),
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
      await request("/claim-relations/" + action, {
        method: "POST",
        body: { from, to, relation, client, reason },
      }),
    );
  }
  if (command === "curation") {
    const action = args.shift();
    if (action !== "queue") throw new Error("Use curation queue");
    // Re-enters raw sources that a scoped rebuild left uncurated, without
    // touching L3. rebuild is the only other way in and it wipes knowledge,
    // including the user's own feedback claims.
    const sourceIds = [];
    for (let i = 0; i < args.length; i++)
      if (args[i] === "--source" && args[i + 1]) sourceIds.push(args[++i]);
    return output(
      await request("/curation/queue", {
        method: "POST",
        body: sourceIds.length ? { sourceIds } : {},
      }),
    );
  }
  if (command === "consolidate") {
    if (args[0] === "status") {
      const topicKey = args[1];
      const result = await request(
        "/consolidations" +
          (topicKey ? "?topicKey=" + encodeURIComponent(topicKey) : ""),
      );
      if (topicKey) return printConsolidationStatus(topicKey, result);
      return output(result);
    }
    if (args[0] === "plan") {
      const all = args.includes("--all");
      const topicKey = !all ? args[1] : undefined;
      if (!all && !topicKey)
        throw new Error("Use consolidate plan TOPIC_KEY or consolidate plan --all");
      return output(
        await request(
          "/consolidations/plan" +
            (topicKey ? "?topic=" + encodeURIComponent(topicKey) : ""),
        ),
      );
    }
    if (args.includes("--all"))
      return output(
        await request("/consolidations", { method: "POST", body: { all: true } }),
      );
    const topicKey = args[0];
    if (!topicKey)
      throw new Error(
        "Use consolidate TOPIC_KEY | consolidate --all | consolidate plan ... | consolidate status ...",
      );
    return output(
      await request("/consolidations", { method: "POST", body: { topicKey } }),
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
