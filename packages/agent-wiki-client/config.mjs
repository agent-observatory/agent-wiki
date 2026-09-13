import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
export const defaultConfigPath = () =>
  join(homedir(), ".agent-wiki", "config.json");
export async function readConfig(path) {
  const config = JSON.parse(await readFile(path, "utf8"));
  if (config.version !== 1 || !config.projects)
    throw new Error("Invalid Wiki configuration");
  return config;
}
export async function writeConfig(path, config) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp-" + process.pid;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, path);
}
export function validateServer(server) {
  const url = new URL(server);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error("HTTPS required; URL credentials forbidden");
  return server.replace(/\/$/, "");
}
export async function loadToken(connection, role = "query") {
  if (connection.envFile) {
    try {
      const values = parseEnv(
        await readFile(resolve(connection.envFile), "utf8"),
      );
      for (const [name, value] of Object.entries(values))
        process.env[name] ??= value;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const token =
    role === "management"
      ? process.env.WIKI_MANAGEMENT_TOKEN
      : role === "collector"
        ? (process.env.WIKI_COLLECTOR_TOKEN ?? process.env.WIKI_TOKEN)
        : process.env.WIKI_TOKEN;
  if (!token)
    throw new Error(
      role === "management"
        ? "Set WIKI_MANAGEMENT_TOKEN in the configured env file"
        : role === "collector"
          ? "Set WIKI_COLLECTOR_TOKEN or WIKI_TOKEN in the configured env file"
          : "Set WIKI_TOKEN in the configured env file",
    );
  return token;
}
