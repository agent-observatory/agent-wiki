import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
const exec = promisify(execFile),
  cli = resolve("packages/agent-wiki-client/cli/agent-wiki.mjs");
const uuid = "00000000-0000-4000-8000-000000000001";
test("one setup shares query and collector settings, preserves scope and machine on rerun, and installs the skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-cli-")),
    config = join(dir, "config.json");
  const env = { ...process.env };
  delete env.WIKI_TOKEN;
  delete env.WIKI_COLLECTOR_TOKEN;
  const run = async (...args) =>
    JSON.parse(
      (
        await exec(process.execPath, [cli, ...args, "--config", config], {
          cwd: dir,
          env,
        })
      ).stdout,
    );
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const manifest = JSON.parse(
      await readFile(
        resolve("packages/agent-wiki-client/package.json"),
        "utf8",
      ),
    );
    assert.deepEqual(manifest.bin, { "agent-wiki": "./cli/agent-wiki.mjs" });
    const tokenFile = join(dir, ".env.local");
    await writeFile(tokenFile, "WIKI_TOKEN=synthetic-cli-token\n");
    await run(
      "setup",
      "--workspace",
      uuid,
      "--project",
      "work",
      "--tag",
      "wiki",
      "--server",
      `http://127.0.0.1:${server.address().port}`,
      "--env",
      tokenFile,
    );
    let c = JSON.parse(await readFile(config, "utf8"));
    assert.deepEqual(c.collector.projects, []);
    assert.equal(c.collector.intervalMinutes, 10);
    assert.equal(c.defaultProject, "work");
    assert.equal(c.collector.connection, "work");
    const machine = c.collector.machine;
    await stat(join(dir, ".agents/skills/agent-wiki/SKILL.md"));
    await run("skill", "install", "--client", "all");
    await stat(join(dir, ".claude/skills/agent-wiki/SKILL.md"));
    await assert.rejects(
      run("skill", "install", "--client", "unknown"),
      /--client must be/,
    );
    await run("setup", "--path", dir, "--interval", "20");
    c = JSON.parse(await readFile(config, "utf8"));
    assert.equal(c.collector.machine, machine);
    assert.deepEqual(c.collector.projects, [dir]);
    await run("collector", "disable", "--client", "claude");
    await run("setup");
    let disabled = JSON.parse(await readFile(config, "utf8"));
    assert.deepEqual(disabled.collector.disabledClients, ["claude"]);
    assert.equal(disabled.collector.machine, machine);
    await run("collector", "enable", "--client", "claude");
    assert.deepEqual(
      JSON.parse(await readFile(config, "utf8")).collector.disabledClients,
      [],
    );
    c = JSON.parse(await readFile(config, "utf8"));
    assert.deepEqual(c.collector.projects, [dir]);
    assert.equal(c.collector.intervalMinutes, 20);
    assert.deepEqual(await run("search", "hello"), { ok: true });
    assert.match(
      requests[0].url,
      new RegExp("/workspaces/" + uuid + "/context"),
    );
    assert.equal(requests[0].authorization, "Bearer synthetic-cli-token");
    await run("search", "why", "--view", "history", "--scope", "production");
    const query = new URL(requests[1].url, "http://localhost").searchParams;
    assert.equal(query.get("view"), "history");
    assert.equal(query.get("scope"), "production");
    await assert.rejects(run("search", "why", "--view", "unknown"));
    // Run collection from the same configuration without touching real session roots.
    c.collector.roots = [];
    await writeFile(config, JSON.stringify(c));
    const result = await run("collector", "run");
    assert.equal(result.failed, 0);
    assert.equal(result.files, 0);
    assert.equal(requests.length, 2);
    assert.deepEqual((await run("collector", "status")).projects, [dir]);
    await run("setup", "--all-projects");
    assert.deepEqual(
      JSON.parse(await readFile(config, "utf8")).collector.projects,
      [],
    );
    await assert.rejects(run("setup", "--interval", "0"));
    await assert.rejects(
      run("setup", "--workspace", "00000000-0000-4000-8000-000000000002"),
      /destination differs/,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

test("management CLI keeps query privilege separate, preserves pause and does not retry writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-manage-")),
    requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    requests.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
      body: body ? JSON.parse(body) : null,
    });
    res.setHeader("content-type", "application/json");
    if (req.method === "GET")
      res.end(
        JSON.stringify({
          enabled: false,
          mode: "byok",
          model: "synthetic",
          version: 7,
          hasKey: true,
          profiles: {},
          freePreset: {},
        }),
      );
    else {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "synthetic unavailable" }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const config = join(dir, "config.json");
  await writeFile(
    config,
    JSON.stringify({
      version: 1,
      defaultProject: "work",
      projects: {
        work: {
          workspace: uuid,
          server: `http://127.0.0.1:${server.address().port}`,
          tag: "wiki",
        },
      },
    }),
  );
  const run = (...args) =>
    exec(process.execPath, [cli, ...args, "--config", config], {
      cwd: dir,
      env: {
        ...process.env,
        WIKI_TOKEN: "query-secret",
        WIKI_MANAGEMENT_TOKEN: "manage-secret",
      },
    });
  try {
    await run("ai", "show");
    assert.equal(requests[0].auth, "Bearer manage-secret");
    const file = join(dir, "config-update.json");
    await writeFile(file, JSON.stringify({ model: "new-synthetic" }));
    await assert.rejects(run("ai", "update", file), /synthetic unavailable/);
    assert.equal(requests.filter((r) => r.method === "PUT").length, 1);
    assert.equal(requests.at(-1).body.config.enabled, false);
    assert.equal(requests.at(-1).body.config.model, "new-synthetic");
    await assert.rejects(
      run("api", "GET", "//evil.invalid"),
      /Workspace-relative/,
    );
    await assert.rejects(run("api", "GET", "/../other"), /Workspace-relative/);
    await assert.rejects(run("api", "POST", "/keys"), /secret-output/);
    await writeFile(file, JSON.stringify({ enabled: true }));
    await assert.rejects(run("ai", "update", file), /pause or ai resume/);
    await run("review", "diff", uuid, "--revision", "2");
    assert.ok(requests.at(-1).url.endsWith("/comparison?revision=2"));
    assert.equal(requests.at(-1).auth, "Bearer query-secret");
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
