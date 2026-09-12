import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  appendFile,
  utimes,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect, redact } from "../packages/collector/collector.mjs";
test("collector resends complete records, defers partial writes and detects same-size replacements", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-collector-"));
  try {
    const path = join(root, "session.jsonl"),
      state = { files: {} },
      sent = [];
    const config = {
      machine: "test",
      name: "test",
      projects: ["/allowed/project"],
      roots: [{ path: root, client: "codex" }],
    };
    const meta =
      JSON.stringify({
        type: "session_meta",
        payload: { id: "session", cwd: "/allowed/project" },
      }) + "\n";
    await writeFile(path, meta + '{"text":"one"}\n{"text":');
    const send = async (data) => {
      sent.push(data);
      return { accepted: data.records.length, duplicate: 0 };
    };
    await collect(config, state, send);
    assert.equal(sent[0].records.length, 2);
    await collect(config, state, send);
    assert.equal(sent.length, 1);
    await appendFile(path, '"two"}\n');
    await collect(config, state, send);
    assert.equal(sent[1].records.length, 3);
    const previous = await stat(path);
    await writeFile(path, meta + '{"text":"new"}\n{"text":"two"}\n');
    await utimes(path, previous.atime, previous.mtime);
    await collect(config, state, send);
    assert.equal(sent.length, 3);
    await writeFile(
      join(root, "excluded.jsonl"),
      JSON.stringify({ cwd: "/different/project" }) + "\n",
    );
    await collect(config, state, send);
    assert.equal(sent.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("failed upload does not advance local sent-state; structured secrets are masked", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-collector-"));
  try {
    const path = join(root, "s.jsonl");
    await writeFile(
      path,
      JSON.stringify({ cwd: "/allowed", password: "secret" }) + "\n",
    );
    const state = { files: {} };
    const result = await collect(
      {
        name: "t",
        machine: "m",
        projects: ["/allowed"],
        roots: [{ client: "claude", path: root }],
      },
      state,
      async () => {
        throw new Error("offline");
      },
    );
    assert.equal(result.failed, 1);
    assert.deepEqual(state.files, {});
    assert.equal(redact({ password: "secret" }).password, "[REDACTED]");
    process.env.AI_ENCRYPTION_KEY = "synthetic-encryption-key";
    assert.equal(redact("synthetic-encryption-key"), "[SECRET_REDACTED]");
    delete process.env.AI_ENCRYPTION_KEY;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
