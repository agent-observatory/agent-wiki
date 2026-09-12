import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  appendFile,
  stat,
  rm,
  readFile,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { collect, redact } from "../packages/collector/collector.mjs";
import {
  prepareUpload,
  scanFile,
  PART_BYTES,
} from "../packages/collector/transport.mjs";
test("streaming preparation separates a 105 MiB image from text while preserving its bytes and masking credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-large-")),
    file = join(dir, "session.jsonl");
  let prepared;
  try {
    const f = await open(file, "w");
    await f.write(
      '{"role":"user","password":"secret","image":"data:image/png;base64,',
    );
    const block = Buffer.alloc(1024 * 1024, 65);
    for (let i = 0; i < 105; i++) await f.write(block);
    await f.write('","text":"보존할 텍스트"}\n{"partial":');
    await f.close();
    const snapshot = await scanFile(file);
    assert.equal(snapshot.records, 1);
    assert.ok(snapshot.end > 100 * 1024 * 1024);
    prepared = await prepareUpload(file, 0, snapshot.end, (x) =>
      redact(x, true),
    );
    assert.ok(prepared.parts.length > 25);
    assert.ok(prepared.parts.every((p) => p.bytes <= PART_BYTES));
    const first = zstdDecompressSync(
      await readFile(join(prepared.dir, "0")),
    ).toString();
    assert.ok(first.includes("[REDACTED]"));
    assert.ok(!first.includes('"secret"'));
    assert.equal(prepared.parts[0].kind, "text");
    assert.ok(first.includes("data:image/agent-wiki;ref="));
    assert.ok(first.includes("보존할 텍스트"));
    assert.ok(first.length < 1000);
    let imageBytes = 0;
    const imageHash = (await import("node:crypto")).createHash("sha256");
    for (let i = 1; i < prepared.parts.length; i++) {
      const p = prepared.parts[i];
      assert.equal(p.kind, "image");
      const raw = zstdDecompressSync(
        await readFile(join(prepared.dir, String(i))),
      );
      if (i === 1)
        assert.ok(raw.toString().startsWith("data:image/png;base64,"));
      imageBytes += raw.length;
      imageHash.update(raw);
    }
    assert.equal(
      imageBytes,
      105 * 1024 * 1024 + "data:image/png;base64,".length,
    );
    assert.equal(imageHash.digest("hex"), prepared.parts[1].asset);
  } finally {
    if (prepared) await prepared.cleanup();
    await rm(dir, { recursive: true, force: true });
  }
});
test("failed request preserves generation but never acknowledges unsent bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-collector-"));
  try {
    const file = join(root, "s.jsonl");
    await writeFile(
      file,
      JSON.stringify({ cwd: "/allowed", text: "safe" }) + "\n",
    );
    const state = { files: {} };
    const result = await collect(
      {
        machine: "m",
        name: "t",
        projects: ["/allowed"],
        roots: [{ client: "claude", path: root }],
      },
      state,
      async () => {
        throw new Error("offline");
      },
    );
    assert.equal(result.failed, 1);
    assert.equal(state.files[file].end, 0);
    assert.equal(redact({ password: "secret" }).password, "[REDACTED]");
    process.env.AI_ENCRYPTION_KEY = "synthetic-encryption-key";
    assert.equal(redact("synthetic-encryption-key"), "[SECRET_REDACTED]");
    delete process.env.AI_ENCRYPTION_KEY;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stream masking does not leak a known secret across the output boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-mask-"));
  process.env.TEST_API_KEY = "synthetic-boundary-credential-value";
  let prepared;
  try {
    const secret = process.env.TEST_API_KEY;
    const file = join(root, "record.jsonl");
    await writeFile(
      file,
      JSON.stringify({ text: " ".repeat(16375) + secret + " ".repeat(40000) }) +
        "\n",
    );
    prepared = await prepareUpload(file, 0, (await stat(file)).size, (x) =>
      redact(x, true),
    );
    const output = zstdDecompressSync(
      await readFile(join(prepared.dir, "0")),
    ).toString();
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes("syntheti"));
    JSON.parse(output);
  } finally {
    delete process.env.TEST_API_KEY;
    if (prepared) await prepared.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});

test("collector defaults to all projects and an explicit scope excludes other projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-scope-"));
  try {
    for (const [name, cwd] of [
      ["wiki", "/work/agent-wiki"],
      ["child", "/work/agent-wiki/docs"],
      ["similar", "/work/agent-wiki-other"],
      ["other", "/work/other"],
      ["unknown", undefined],
    ])
      await writeFile(
        join(root, name + ".jsonl"),
        JSON.stringify({ cwd, text: "synthetic" }) + "\n",
      );
    const base = {
      machine: "m",
      name: "test",
      roots: [{ client: "codex", path: root }],
    };
    // Stop at the first request; the state reveals exactly which files passed the scope filter.
    for (const [projects, expected] of [
      [undefined, 5],
      [[], 5],
      [["/work/agent-wiki"], 2],
    ]) {
      const state = { files: {} };
      await collect({ ...base, projects }, state, async () => {
        throw new Error("offline");
      });
      assert.equal(Object.keys(state.files).length, expected);
      if (expected === 2)
        assert.deepEqual(
          Object.keys(state.files)
            .map((p) => p.split("/").at(-1))
            .sort(),
          ["child.jsonl", "wiki.jsonl"],
        );
    }
    await assert.rejects(
      collect({ ...base, projects: "wrong" }, { files: {} }, async () => {}),
      /projects must be/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
