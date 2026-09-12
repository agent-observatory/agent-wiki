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
import { createReadStream } from "node:fs";
import { readConfig, writeConfig, loadToken } from "../config.mjs";
import { prepareUpload, scanFile, MASK_VERSION } from "./transport.mjs";
const digest = (x) => createHash("sha256").update(x).digest("hex");
export function redact(value, preserveImages = false) {
  if (Array.isArray(value)) return value.map((x) => redact(x, preserveImages));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(?:password|secret|api[_-]?key|access[_-]?token|authorization|private[_-]?key)$/i.test(
          k,
        )
          ? "[REDACTED]"
          : redact(v, preserveImages),
      ]),
    );
  if (typeof value !== "string") return value;
  if (!preserveImages)
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
export async function collect(
  config,
  state,
  request,
  checkpoint = async () => {},
  transfer = uploadPart,
) {
  if (
    config.projects !== undefined &&
    (!Array.isArray(config.projects) ||
      config.projects.some((p) => typeof p !== "string" || !p.trim()))
  )
    throw new Error("projects must be an array of non-empty paths");
  const projects = config.projects ?? [];
  const stats = {
    files: 0,
    accepted: 0,
    duplicate: 0,
    failed: 0,
    pending: 0,
    errors: {},
  };
  for (const root of config.roots)
    for await (const file of walk(root.path)) {
      if ((config.exclude ?? []).some((p) => file.includes(p))) continue;
      let prepared;
      try {
        const fh = await open(file, "r");
        let prefix;
        try {
          const b = Buffer.alloc(262144);
          const { bytesRead } = await fh.read(b, 0, b.length, 0);
          prefix = b.subarray(0, bytesRead).toString("utf8");
        } finally {
          await fh.close();
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
        const cwd = metadata.map((x) => x.cwd ?? x.payload?.cwd).find(Boolean);
        if (
          projects.length > 0 &&
          (!cwd ||
            !projects.some(
              (p) =>
                resolve(cwd) === resolve(p) ||
                resolve(cwd).startsWith(resolve(p) + "/"),
            ))
        )
          continue;
        let local = state.files[file];
        if (!local || typeof local === "string")
          local = {
            generation: randomUUID(),
            end: 0,
            prefixHash: digest(""),
            fallbackSession: randomUUID(),
          };
        let snapshot = await scanFile(file, local.end);
        if (!snapshot.end) continue;
        if (
          snapshot.end < local.end ||
          snapshot.previousHash !== local.prefixHash
        ) {
          local = {
            ...local,
            generation: randomUUID(),
            end: 0,
            prefixHash: digest(""),
            pending: undefined,
            pendingRange: undefined,
          };
        }
        state.files[file] = local;
        await checkpoint();
        const session = String(
          metadata.find((x) => x.type === "session_meta")?.payload?.id ??
            metadata.find((x) => x.sessionId)?.sessionId ??
            local.fallbackSession,
        );
        const identity = {
          machine: config.machine,
          fileId: digest(file),
          generation: local.generation,
          client: root.client,
          sessionId: session,
        };
        if (local.pending) {
          const status = await request(
            "/uploads/" + local.pending,
            undefined,
            "GET",
          );
          if (status.status === "completed") {
            stats.accepted += status.result.accepted;
            stats.duplicate += status.result.duplicate;
            delete local.pending;
            delete local.parts;
            delete local.pendingRange;
          } else if (status.status === "uploading" && local.pendingRange) {
            const range = local.pendingRange;
            const check = await scanFile(file, range.end);
            if (
              snapshot.end < range.end ||
              check.previousHash !== range.prefixHash
            ) {
              local.generation = randomUUID();
              local.end = 0;
              local.prefixHash = digest("");
              delete local.pending;
              delete local.pendingRange;
              delete local.parts;
              await checkpoint();
              continue;
            }
            snapshot = {
              ...snapshot,
              end: range.end,
              records: range.recordEnd,
              prefixHash: range.prefixHash,
            };
          } else if (["queued", "verifying"].includes(status.status)) {
            stats.pending++;
            continue;
          } else if (status.status === "failed")
            throw new Error("UPLOAD_VALIDATION_FAILED");
          else if (status.status === "expired") {
            local.generation = randomUUID();
            delete local.pending;
            local.end = 0;
            local.prefixHash = digest("");
            await checkpoint();
            continue;
          }
        }
        const cursor = await request("/cursor", identity);
        cursor.end = Number(cursor.end);
        // Server cursor is authoritative, but it only applies to the unchanged prefix
        // of this exact file generation. Another machine has its own cursor.
        if (cursor.end > 0) {
          const check = await scanFile(file, cursor.end);
          if (
            cursor.end > snapshot.end ||
            check.previousHash !== cursor.prefixHash
          ) {
            local.generation = randomUUID();
            local.end = 0;
            local.prefixHash = digest("");
            delete local.pending;
            await checkpoint();
            continue;
          }
        }
        local.end = cursor.end;
        local.prefixHash = cursor.prefixHash || digest("");
        if (cursor.end === snapshot.end) {
          stats.files++;
          await checkpoint();
          continue;
        }
        while (true) {
          try {
            prepared = await prepareUpload(
              file,
              cursor.end,
              snapshot.end,
              (x) => redact(x, true),
            );
            break;
          } catch (error) {
            if (error.message !== "UPLOAD_TOO_LARGE" || local.pending)
              throw error;
            // Keep complete JSON events together and leave the rest for the next acknowledged range.
            const smaller = await scanFile(
              file,
              cursor.end,
              cursor.end + Math.floor((snapshot.end - cursor.end) / 2),
            );
            if (smaller.end >= snapshot.end || smaller.end <= cursor.end)
              throw error;
            snapshot = smaller;
          }
        }
        // Detect edits made while preparing the snapshot; never assign old offsets to new content.
        const check = await scanFile(file, snapshot.end);
        if (check.previousHash !== snapshot.prefixHash)
          throw new Error("FILE_CHANGED_DURING_READ");
        const payload = {
          ...identity,
          name: config.name + " · " + root.client + " · " + session.slice(0, 8),
          start: cursor.end,
          end: snapshot.end,
          recordStart: cursor.recordEnd,
          recordEnd: snapshot.records,
          prefixHash: snapshot.prefixHash,
          maskVersion: MASK_VERSION,
          codec: "zstd",
          parts: prepared.parts,
        };
        const upload = await request("/uploads", payload);
        if (local.pending !== upload.id) local.parts = [];
        local.pending = upload.id;
        local.pendingRange = {
          end: payload.end,
          recordEnd: payload.recordEnd,
          prefixHash: payload.prefixHash,
        };
        local.parts ??= [];
        await checkpoint();
        if (upload.status === "uploading") {
          for (let i = 0; i < prepared.parts.length; i++) {
            if (local.parts[i] === prepared.parts[i].compressedHash) continue;
            const grant = await request(
              "/uploads/" + upload.id + "/parts/" + i,
              {},
            );
            await transfer(grant.url, join(prepared.dir, String(i)));
            local.parts[i] = prepared.parts[i].compressedHash;
            await checkpoint();
          }
          await request("/uploads/" + upload.id + "/complete", {});
        } else if (upload.status === "failed")
          throw new Error("UPLOAD_VALIDATION_FAILED");
        stats.pending++;
        stats.files++;
      } catch (error) {
        const code =
          /^(HTTP_[0-9]{3}|UPLOAD_[A-Z_]+|FILE_CHANGED_DURING_READ)$/.test(
            error.message,
          )
            ? error.message
            : "COLLECTION_FAILED";
        stats.errors[code] = (stats.errors[code] ?? 0) + 1;
        stats.failed++;
      } finally {
        if (prepared) await prepared.cleanup();
      }
    }
  await checkpoint();
  return stats;
}
async function uploadPart(url, file) {
  if (typeof url !== "string") throw new Error("UPLOAD_URL_MISSING");
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    !/^objectstorage\.[a-z0-9-]+\.oraclecloud\.com$/.test(u.hostname)
  )
    throw new Error("UPLOAD_URL_REJECTED");
  for (let attempt = 0; attempt < 3; attempt++) {
    const stream = createReadStream(file);
    try {
      const r = await fetch(url, {
        method: "PUT",
        redirect: "error",
        signal: AbortSignal.timeout(120000),
        headers: {
          "content-type": "application/zstd",
          "content-length": String((await stat(file)).size),
        },
        body: stream,
        duplex: "half",
      });
      await r.body?.cancel();
      if (r.ok) return;
      if (r.status < 500 && r.status !== 429)
        throw new Error("HTTP_" + r.status);
    } catch (e) {
      if (e.message?.startsWith("HTTP_") || attempt === 2) throw e;
    } finally {
      stream.destroy();
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error("UPLOAD_TRANSFER_FAILED");
}
export function collectionInterval(value = 10) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    throw new Error(
      "Collection interval must be an integer from 1 to 1440 minutes",
    );
  return minutes;
}
export async function collectorMain(args, configPath, cliPath) {
  const command = args.shift() ?? "status";
  const opt = (key, fallback) => {
    const i = args.indexOf("--" + key);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error("Missing --" + key);
    return args[i + 1];
  };
  if (!["run", "start", "stop", "status"].includes(command))
    throw new Error(
      "Use wiki collector run|start|stop|status [--interval MINUTES]",
    );
  const settings = await readConfig(configPath);
  const connection = settings.projects[settings.collector?.connection];
  if (!connection || !settings.collector)
    throw new Error("Run wiki setup to configure collection");
  const config = { ...settings.collector, ...connection };
  const label = "org.agent-observatory.wiki-collector";
  const domain = "gui/" + process.getuid?.();
  if (command === "status") {
    const current =
      process.platform === "darwin"
        ? spawnSync("launchctl", ["print", domain + "/" + label], {
            encoding: "utf8",
          })
        : null;
    console.log(
      JSON.stringify({
        projects: config.projects?.length ? config.projects : "all",
        intervalMinutes: config.intervalMinutes ?? 10,
        scheduled: current?.status === 0,
        scheduledIntervalMinutes:
          Number(
            current?.stdout?.match(/run interval = (\d+) seconds/)?.[1] ?? 0,
          ) / 60 || null,
        config: configPath,
      }),
    );
    return;
  }
  if (command === "stop") {
    if (process.platform !== "darwin")
      throw new Error("Stop the scheduler that runs wiki collector run");
    const exists = spawnSync("launchctl", ["print", domain + "/" + label], {
      stdio: "ignore",
    });
    if (exists.status === 0) {
      const stopped = spawnSync(
        "launchctl",
        ["bootout", domain + "/" + label],
        { stdio: "ignore" },
      );
      if (stopped.status) throw new Error("Scheduler stop failed");
    }
    console.log(JSON.stringify({ scheduled: false }));
    return;
  }
  if (command === "start") {
    const interval = collectionInterval(
      opt("interval", config.intervalMinutes ?? 10),
    );
    if (process.platform !== "darwin")
      throw new Error(
        `Use your scheduler to run collector once every ${interval} minutes`,
      );
    await writeConfig(configPath, {
      ...settings,
      collector: { ...settings.collector, intervalMinutes: interval },
    });
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
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[process.execPath, cliPath, "collector", "run", "--config", configPath].map((s) => "<string>" + escape(s) + "</string>").join("")}</array><key>StartInterval</key><integer>${interval * 60}</integer><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${escape(log)}</string><key>StandardErrorPath</key><string>${escape(log)}</string></dict></plist>`,
      { mode: 0o600 },
    );
    spawnSync("launchctl", ["bootout", domain + "/" + label], {
      stdio: "ignore",
    });
    const r = spawnSync("launchctl", ["bootstrap", domain, plist], {
      stdio: "inherit",
    });
    if (r.status) throw new Error("Scheduler install failed");
    console.log(`Collector scheduled every ${interval} minutes`);
    return;
  }
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
  const token = await loadToken(connection, "collector");
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
      lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(String(process.pid));
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
    const result = await collect(
      config,
      state,
      async (path, payload, method = "POST") => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const response = await fetch(
            config.server.replace(/\/$/, "") +
              "/api/workspaces/" +
              config.workspace +
              "/collection" +
              path,
            {
              method,
              redirect: "error",
              signal: AbortSignal.timeout(60000),
              headers: {
                authorization: "Bearer " + token,
                "content-type": "application/json",
              },
              ...(payload === undefined
                ? {}
                : { body: JSON.stringify(payload) }),
            },
          );
          if (
            (response.status === 429 || response.status >= 500) &&
            attempt < 3
          ) {
            const delay = Math.min(
              120,
              Math.max(
                1,
                Number(response.headers.get("retry-after")) || 2 ** attempt,
              ),
            );
            await response.body?.cancel();
            await new Promise((r) => setTimeout(r, delay * 1000));
            continue;
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error("HTTP_" + response.status);
          }
          return response.json();
        }
        throw new Error("HTTP_RETRY_EXHAUSTED");
      },
      () => atomic(statePath, state),
    );
    await atomic(statePath, state);
    console.log(JSON.stringify({ time: new Date().toISOString(), ...result }));
    if (result.failed) process.exitCode = 1;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
