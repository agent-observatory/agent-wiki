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
    await run("setup");
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
