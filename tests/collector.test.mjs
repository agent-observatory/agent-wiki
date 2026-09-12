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
test("streaming preparation preserves large image in L1 while masking structured credentials and detecting partial lines", async () => {
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
    assert.ok(first.includes("data:image/png;base64,"));
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
