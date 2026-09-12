#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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
const project = option("project", "agent-wiki");
const configPath = resolve(option("config", ".agent-wiki.json"));
const jsonFile = async (p) => JSON.parse(await readFile(p, "utf8"));
const output = (x) => process.stdout.write(JSON.stringify(x, null, 2) + "\n");
async function main() {
  if (!command || command === "help" || command === "--help") {
    output({
      commands: [
        "init --project NAME --workspace ID --tag TAG [--server URL]",
        "recall --project NAME",
        'search "question" [--tag TAG]',
        "source add FILE [--kind conversation|document|code|note] [--origin LOCATION]",
        "source get ID [--start N --end N]",
        "publish FILE.json",
        "publication status KEY",
        "article ID [--revision N]",
        "skill install",
      ],
      configuration:
        ".agent-wiki.json (nonsecret); WIKI_TOKEN in environment or adjacent .env.local",
    });
    return;
  }
  if (command === "init") {
    let config = { projects: {} };
    try {
      config = await jsonFile(configPath);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const workspace = option("workspace");
    const tag = option("tag", project);
    const server = option("server", "https://agent-wiki.duckdns.org").replace(
      /\/$/,
      "",
    );
    if (!/^[\da-f-]{36}$/.test(workspace ?? ""))
      throw new Error("Workspace UUID is required");
    const url = new URL(server);
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      throw new Error("HTTPS required");
    config.projects[project] = { server, workspace, tag };
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    output({ configured: project, config: configPath });
    return;
  }
  if (command === "skill" && args[0] === "install") {
    const target = resolve(".agents/skills/agent-wiki");
    await mkdir(target, { recursive: true });
    await cp(fileURLToPath(new URL("./skill/", import.meta.url)), target, {
      recursive: true,
    });
    output({
      installed: target,
      note: "프로젝트 지침에서 시작·재개 시 wiki recall을 호출하도록 연결하세요.",
    });
    return;
  }
  const config = await jsonFile(configPath);
  const connection = config.projects[project];
  if (!connection)
    throw new Error("Project connection missing. Run wiki init.");
  let token = process.env.WIKI_TOKEN;
  if (!token) {
    try {
      const file = await readFile(
        resolve(dirname(configPath), ".env.local"),
        "utf8",
      );
      for (const line of file.split(/\r?\n/)) {
        const match = line.match(/^WIKI_TOKEN=(.*)$/);
        if (match) token = match[1].trim().replace(/^['"]|['"]$/g, "");
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  if (!token) throw new Error("Set WIKI_TOKEN in environment or .env.local");
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
    if (!args[0]) throw new Error("Search question required");
    return output(
      await request("/context?" + new URLSearchParams({ q: args[0], tag })),
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
  throw new Error("Unknown command. Run wiki help.");
}
main().catch((e) => {
  process.stderr.write(
    JSON.stringify({ error: e.status ? e.message : (e.code ?? e.message) }) +
      "\n",
  );
  process.exitCode = 1;
});
