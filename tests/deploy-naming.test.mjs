import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

for (const fail of [false, true]) {
  test(`Compose name transition ${fail ? "restores old services after startup failure" : "preserves storage and drains before switching"}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-wiki-deploy-"));
    try {
      const bin = join(dir, "bin");
      await mkdir(bin);
      for (const name of ["flock", "mountpoint"])
        await writeFile(join(bin, name), "#!/bin/sh\nexit 0\n", {
          mode: 0o755,
        });
      await writeFile(
        join(bin, "openssl"),
        '#!/bin/sh\necho "Hostname agent-wiki-db does match certificate"\n',
        { mode: 0o755 },
      );
      await writeFile(
        join(bin, "docker"),
        `#!/bin/sh
printf '%s\\n' "$*" >> "$DEPLOY_TEST_LOG"
case "$*" in
  *"compose -f compose.next.yaml up "*"agent-wiki-worker"*)
    if [ "$DEPLOY_TEST_FAIL" = 1 ] && [ ! -f "$DEPLOY_TEST_LOG.failed" ]; then
      touch "$DEPLOY_TEST_LOG.failed"
      exit 1
    fi;;
esac
`,
        { mode: 0o755 },
      );
      const original = {};
      for (const name of [
        "compose.yaml",
        "Caddyfile",
        "api.env",
        "worker.env",
        "migration.env",
      ]) {
        original[name] = name.endsWith(".env")
          ? "DATABASE_URL=postgresql://synthetic:private-test@postgres:5432/agent_wiki\n"
          : "original " + name + "\n";
        await writeFile(join(dir, name), original[name]);
      }
      await writeFile(join(dir, ".env"), "IMAGE_TAG=" + "a".repeat(40) + "\n");
      await writeFile(join(dir, "compose.next.yaml"), "new compose\n");
      await writeFile(join(dir, "Caddyfile.next"), "new caddy\n");
      const source = await readFile(
        resolve("scripts/migrate-service-names.sh"),
        "utf8",
      );
      const script = source
        .replaceAll("/opt/agent-wiki", dir)
        .replace("/tmp/agent-wiki-deploy.lock", join(dir, "deploy.lock"));
      await writeFile(join(dir, "transition.sh"), script);
      const log = join(dir, "commands.log");
      const result = spawnSync(
        "bash",
        [join(dir, "transition.sh"), "b".repeat(40)],
        {
          env: {
            ...process.env,
            PATH: bin + ":" + process.env.PATH,
            DEPLOY_TEST_LOG: log,
            DEPLOY_TEST_FAIL: fail ? "1" : "0",
          },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, fail ? 1 : 0, result.stderr);
      const commands = await readFile(log, "utf8");
      const steps = [
        "stop -t 45 web",
        "stop -t 120 worker",
        "stop -t 45 api",
        "stop -t 120 postgres",
        "--wait agent-wiki-db",
        "--wait agent-wiki-api agent-wiki-web agent-wiki-worker",
      ];
      for (let i = 1; i < steps.length; i++)
        assert.ok(
          commands.indexOf(steps[i - 1]) < commands.indexOf(steps[i]),
          steps.join(" → "),
        );
      assert.doesNotMatch(
        commands,
        /\bdown\b|\bcompose[^\n]*\brm\s+[^\n]*(?:--volumes|\s-v\b)|private-test/,
      );
      if (fail) {
        for (const [name, value] of Object.entries(original))
          assert.equal(await readFile(join(dir, name), "utf8"), value);
        assert.match(commands, /--wait postgres/);
        assert.match(commands, /--wait api web worker caddy/);
        assert.doesNotMatch(commands, /rm -f web/);
        assert.equal(
          await readFile(join(dir, ".env"), "utf8"),
          "IMAGE_TAG=" + "a".repeat(40) + "\n",
        );
      } else {
        assert.equal(
          await readFile(join(dir, "api.env"), "utf8"),
          original["api.env"].replace("@postgres:", "@agent-wiki-db:"),
        );
        assert.equal(
          await readFile(join(dir, "compose.yaml"), "utf8"),
          "new compose\n",
        );
        assert.match(commands, /rm -f web worker api postgres caddy/);
        assert.equal(
          await readFile(join(dir, ".env"), "utf8"),
          "IMAGE_TAG=" + "b".repeat(40) + "\n",
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
