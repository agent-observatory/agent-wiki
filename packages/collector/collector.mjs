#!/usr/bin/env node
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  open,
  unlink,
  rename,
  chmod,
} from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const digest = (x) => createHash("sha256").update(x).digest("hex");
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(?:password|secret|api[_-]?key|access[_-]?token|authorization|private[_-]?key)$/i.test(
          k,
        )
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  if (typeof value !== "string") return value;
  value = value.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\r\n]+/g,
    "[IMAGE_DATA_OMITTED]",
  );
  for (const [name, secret] of Object.entries(process.env))
    if (
      /TOKEN|PASSWORD|SECRET|API_KEY|ENCRYPTION_KEY/.test(name) &&
      secret &&
      secret.length >= 12
    )
      value = value.replaceAll(secret, "[SECRET_REDACTED]");
  return value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[PRIVATE_KEY_REDACTED]",
    )
    .replace(
      /https:\/\/hooks\.slack\.com\/services\/[^\s"'<>]+/g,
      "[WEBHOOK_REDACTED]",
    )
    .replace(
      /\b(?:aw_[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|nvapi-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,})\b/g,
      "[TOKEN_REDACTED]",
    )
    .replace(
      /((?:password|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    );
}
async function atomic(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + "." + randomUUID();
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, path);
}
async function* walk(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
  }
}
export async function collect(config, state, send) {
  const stats = { files: 0, accepted: 0, duplicate: 0, failed: 0, errors: {} };
  for (const root of config.roots)
    for await (const file of walk(root.path)) {
      if ((config.exclude ?? []).some((pattern) => file.includes(pattern)))
        continue;
      try {
        // Establish project scope from metadata before loading unrelated large sessions.
        const fileHandle = await open(file, "r");
        let prefix;
        try {
          const buffer = Buffer.alloc(262144);
          const { bytesRead } = await fileHandle.read(
            buffer,
            0,
            buffer.length,
            0,
          );
          prefix = buffer.subarray(0, bytesRead).toString("utf8");
        } finally {
          await fileHandle.close();
        }
        const metadata = prefix
          .split("\n")
          .slice(0, -1)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
        const knownCwd = metadata
          .map((x) => x.cwd ?? x.payload?.cwd)
          .find(Boolean);
        if (
          knownCwd &&
          !config.projects.some(
            (p) =>
              resolve(knownCwd) === resolve(p) ||
              resolve(knownCwd).startsWith(resolve(p) + "/"),
          )
        )
          continue;
        const info = await stat(file);
        if (info.size > 256 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
        const buffer = await readFile(file, "utf8"),
          end = buffer.lastIndexOf("\n");
        if (end < 0) continue;
        const complete = buffer.slice(0, end),
          fingerprint = digest(complete);
        // Hash the complete prefix too: preserved mtimes and same-size replacements are detectable.
        if (state.files[file] === fingerprint) continue;
        const lines = complete.split("\n").filter((x) => x.trim());
        const records = lines.map((x) => JSON.parse(x));
        const cwd = records.map((x) => x.cwd ?? x.payload?.cwd).find(Boolean);
        if (
          !cwd ||
          !config.projects.some(
            (p) =>
              resolve(cwd) === resolve(p) ||
              resolve(cwd).startsWith(resolve(p) + "/"),
          )
        )
          continue;
        const session = String(
          records.find((x) => x.type === "session_meta")?.payload?.id ??
            records.find((x) => x.sessionId)?.sessionId ??
            digest(file),
        );
        const cleaned = records.map((x) => JSON.stringify(redact(x)));
        let start = 0;
        while (start < cleaned.length) {
          let count = 0,
            size = 0;
          while (start + count < cleaned.length && count < 50) {
            const bytes = Buffer.byteLength(cleaned[start + count]) + 1;
            if (bytes > 1000000) throw new Error("RECORD_TOO_LARGE");
            if (count && size + bytes > 16000) break;
            size += bytes;
            count++;
          }
          const result = await send({
            machine: config.machine,
            client: root.client,
            sessionId: session,
            name:
              config.name + " · " + root.client + " · " + session.slice(0, 8),
            start,
            records: cleaned.slice(start, start + count),
          });
          stats.accepted += result.accepted;
          stats.duplicate += result.duplicate;
          start += count;
        }
        state.files[file] = fingerprint;
        stats.files++;
      } catch (error) {
        const code = /^(?:HTTP_[0-9]{3}|FILE_TOO_LARGE|RECORD_TOO_LARGE)$/.test(
          error.message,
        )
          ? error.message
          : error instanceof SyntaxError
            ? "INVALID_JSON"
            : "COLLECTION_FAILED";
        stats.errors[code] = (stats.errors[code] ?? 0) + 1;
        stats.failed++;
      }
    }
  return stats;
}
async function main() {
  const args = process.argv.slice(2),
    command = args.shift() ?? "help";
  const opt = (key, fallback) => {
    const i = args.indexOf("--" + key);
    return i < 0 ? fallback : args[i + 1];
  };
  const configPath = resolve(
    opt("config", join(homedir(), ".agent-wiki", "collector.json")),
  );
  if (command === "init") {
    const workspace = opt("workspace"),
      project = opt("project"),
      server = opt("server", "https://agent-wiki.duckdns.org");
    if (!workspace || !project)
      throw new Error(
        "Use init --workspace UUID --project /absolute/project [--server URL]",
      );
    try {
      await stat(configPath);
      throw new Error("Config already exists; edit it to add projects");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await atomic(configPath, {
      server,
      workspace,
      name: opt("name", "Agent Wiki"),
      machine: randomUUID(),
      envFile: resolve(opt("env", ".env.local")),
      projects: [resolve(project)],
      exclude: [],
      roots: [
        { client: "codex", path: join(homedir(), ".codex", "sessions") },
        { client: "claude", path: join(homedir(), ".claude", "projects") },
      ],
    });
    console.log("Collector configured: " + configPath);
    return;
  }
  if (command === "install") {
    if (process.platform !== "darwin")
      throw new Error(
        "Use your scheduler to run collector once every 30 minutes",
      );
    await stat(configPath);
    const label = "org.agent-observatory.wiki-collector";
    const log = join(dirname(configPath), "collector.log");
    const escape = (s) =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    const plist = join(homedir(), "Library", "LaunchAgents", label + ".plist");
    await mkdir(dirname(plist), { recursive: true });
    await writeFile(log, "", { flag: "a", mode: 0o600 });
    await chmod(log, 0o600);
    await writeFile(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[process.execPath, fileURLToPath(import.meta.url), "once", "--config", configPath].map((s) => "<string>" + escape(s) + "</string>").join("")}</array><key>StartInterval</key><integer>1800</integer><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${escape(log)}</string><key>StandardErrorPath</key><string>${escape(log)}</string></dict></plist>`,
      { mode: 0o600 },
    );
    const domain = "gui/" + process.getuid();
    spawnSync("launchctl", ["bootout", domain + "/" + label], {
      stdio: "ignore",
    });
    const r = spawnSync("launchctl", ["bootstrap", domain, plist], {
      stdio: "inherit",
    });
    if (r.status) throw new Error("Scheduler install failed");
    console.log("Collector scheduled every 30 minutes");
    return;
  }
  if (command !== "once") {
    console.log(
      "wiki-collector init --workspace UUID --project PATH [--env .env.local]\nwiki-collector once [--config PATH]\nwiki-collector install [--config PATH]",
    );
    return;
  }
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!config.projects?.length)
    throw new Error("Explicit project allowlist required");
  const url = new URL(config.server);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    )
  )
    throw new Error("HTTPS required");
  if (url.username || url.password)
    throw new Error("URL credentials forbidden");
  if (config.envFile) process.loadEnvFile(config.envFile);
  const token = process.env.WIKI_COLLECTOR_TOKEN ?? process.env.WIKI_TOKEN;
  if (!token) throw new Error("WIKI_COLLECTOR_TOKEN required");
  const lockPath = configPath + ".lock";
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(String(process.pid));
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const pid = Number(await readFile(lockPath, "utf8"));
    try {
      process.kill(pid, 0);
      console.log("Collector already running");
      return;
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
      await unlink(lockPath);
      throw new Error("Removed stale lock; run again");
    }
  }
  const statePath = configPath + ".state";
  let state = { files: {} };
  try {
    try {
      state = JSON.parse(await readFile(statePath, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const result = await collect(config, state, async (payload) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch(
          config.server.replace(/\/$/, "") +
            "/api/workspaces/" +
            config.workspace +
            "/collection",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(60000),
            headers: {
              authorization: "Bearer " + token,
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < 3
        ) {
          const seconds =
            response.status === 429
              ? Math.min(
                  120,
                  Math.max(
                    1,
                    Number(response.headers.get("retry-after")) || 60,
                  ),
                )
              : 2 ** attempt;
          await response.body?.cancel();
          await new Promise((r) => setTimeout(r, seconds * 1000));
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("HTTP_" + response.status);
        }
        return response.json();
      }
      throw new Error("HTTP_RETRY_EXHAUSTED");
    });
    await atomic(statePath, state);
    console.log(JSON.stringify({ time: new Date().toISOString(), ...result }));
    if (result.failed) process.exitCode = 1;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : "Collector failed");
    process.exitCode = 1;
  });
