import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  appendFile,
  readFile,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildApp } from "../apps/api/src/app.js";
import { pool, tx } from "../packages/core/src/db.js";
import {
  hash,
  putBlob,
  getSource,
  deleteBlob,
} from "../packages/core/src/storage.js";
import { processUpload } from "../apps/worker/src/ingest.js";
// @ts-expect-error standalone collector module
import { collect } from "../packages/collector/collector.mjs";
const owner = "upload-test-" + randomUUID(),
  token = randomUUID();
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let app: Awaited<ReturnType<typeof buildApp>>,
  ws: string,
  root: string,
  key: string;
const headers = {
  cookie: "wiki_session=" + token,
  origin: "http://localhost:3000",
  "content-type": "application/json",
};
before(async () => {
  process.env.OWNER_GITHUB_ID = owner;
  await admin.query("INSERT INTO users(id,login) VALUES($1,$1)", [owner]);
  await admin.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), owner],
  );
  app = await buildApp();
  ws = (
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers,
      payload: { name: "Upload integration" },
    })
  ).json().id;
  key = (
    await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws}/keys`,
      headers,
      payload: { name: "collector", scope: "source:write" },
    })
  ).json().token;
  root = await mkdtemp(join(tmpdir(), "wiki-upload-test-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
  await app.close();
  await pool.end();
  await admin.end();
});
function transport(workspace = ws) {
  let target = "",
    manifests: any[] = [];
  return {
    manifests,
    request: async (path: string, payload?: any, method: any = "POST") => {
      const r = await app.inject({
        method,
        url: `/api/workspaces/${workspace}/collection${path}`,
        headers: {
          authorization: "Bearer " + key,
          "content-type": "application/json",
        },
        payload,
      });
      assert.equal(r.statusCode, 200, r.body);
      if (path === "/uploads") manifests.push(payload);
      if (path.includes("/parts/")) {
        const m = path.match(/uploads\/([^/]+)\/parts\/(\d+)/)!;
        target = `staging/${workspace}/${m[1]}/${m[2]}.zst`;
      }
      return r.json();
    },
    transfer: async (_url: string, file: string) =>
      putBlob(target, await readFile(file)),
  };
}
const config = () => ({
  machine: "mac",
  name: "Synthetic",
  projects: ["/allowed"],
  roots: [{ client: "codex", path: root }],
});
const meta =
  JSON.stringify({
    type: "session_meta",
    payload: { id: "session-one", cwd: "/allowed" },
  }) + "\n";
test("direct upload does not advance until verified; only appended bytes travel; copies deduplicate across machines", async () => {
  const file = join(root, "session.jsonl"),
    state = { files: {} },
    t = transport();
  await writeFile(
    file,
    meta +
      JSON.stringify({
        role: "user",
        content: "첫 결정",
        password: "synthetic-secret",
      }) +
      "\n",
  );
  assert.equal(
    (await collect(config(), state, t.request, async () => {}, t.transfer))
      .failed,
    0,
  );
  let cursor = (
    await tx(owner, ws, (c) =>
      c.query("SELECT byte_end FROM collection_origins WHERE workspace_id=$1", [
        ws,
      ]),
    )
  ).rows[0];
  assert.equal(Number(cursor.byte_end), 0);
  assert.equal(await processUpload(owner, new AbortController().signal), true);
  await collect(config(), state, t.request, async () => {}, t.transfer);
  assert.equal(t.manifests.length, 1);
  const obsolete = await app.inject({
    method: "POST",
    url: `/api/workspaces/${ws}/collection/uploads`,
    headers: {
      authorization: "Bearer " + key,
      "content-type": "application/json",
    },
    payload: { ...t.manifests[0], maskVersion: "stream-mask-1" },
  });
  assert.equal(obsolete.statusCode, 400);

  const size = (await stat(file)).size;
  await appendFile(
    file,
    JSON.stringify({ role: "user", content: "추가 결정" }) + '\n{"unfinished":',
  );
  assert.equal(
    (await collect(config(), state, t.request, async () => {}, t.transfer))
      .failed,
    0,
  );
  assert.equal(t.manifests[1].start, size);
  assert.equal(t.manifests[1].recordEnd, 3);
  await processUpload(owner, new AbortController().signal);
  await collect(config(), state, t.request, async () => {}, t.transfer);
  assert.equal(t.manifests.length, 2);
  const other = transport();
  await collect(
    { ...config(), machine: "second-mac" },
    { files: {} },
    other.request,
    async () => {},
    other.transfer,
  );
  await processUpload(owner, new AbortController().signal);
  const uploads = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT result FROM collection_uploads WHERE workspace_id=$1 AND status='completed' ORDER BY created_at",
        [ws],
      ),
    )
  ).rows;
  assert.equal(uploads[2].result.accepted, 0);
  assert.equal(uploads[2].result.duplicate, 3);
  const rows = (
    await tx(owner, ws, (c) =>
      c.query("SELECT object_key,metadata FROM sources WHERE workspace_id=$1", [
        ws,
      ]),
    )
  ).rows;
  assert.ok(rows.every((x) => x.metadata.rawUploadId));
  for (const row of rows)
    assert.ok(!(await getSource(row.object_key)).includes("synthetic-secret"));
  const info = await stat(file);
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace("추가 결정", "수정 결정"),
  );
  await utimes(file, info.atime, info.mtime);
  await collect(config(), state, t.request, async () => {}, t.transfer);
  assert.notEqual(t.manifests.at(-1).generation, t.manifests[1].generation);
  assert.equal(t.manifests.at(-1).start, 0);
});
test("tampered part fails verification without moving cursor or creating L1", async () => {
  const t = transport(),
    state = { files: {} };
  await writeFile(
    join(root, "bad.jsonl"),
    JSON.stringify({
      type: "session_meta",
      payload: { id: "bad-session", cwd: "/allowed" },
    }) + "\n",
  );
  const r = await collect(
    config(),
    state,
    t.request,
    async () => {},
    async (url: string, file: string) => {
      await writeFile(file, "tampered");
      await t.transfer(url, file);
    },
  );
  assert.equal(r.failed, 0);
  // Another test may have left a valid queued rewrite, drain all pending uploads.
  while (await processUpload(owner, new AbortController().signal)) {}
  const row = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT u.error_code,o.byte_end FROM collection_uploads u JOIN collection_origins o ON o.workspace_id=u.workspace_id AND o.id=u.origin_id WHERE u.workspace_id=$1 AND u.manifest->>'sessionId'='bad-session'",
        [ws],
      ),
    )
  ).rows[0];
  assert.equal(row.error_code, "UPLOAD_HASH_MISMATCH");
  assert.equal(Number(row.byte_end), 0);
});

test("native event IDs deduplicate shifted records and repeated IDs within an upload", async () => {
  while (await processUpload(owner, new AbortController().signal)) {}
  const file = join(root, "native.jsonl"),
    t = transport(),
    state = { files: {} };
  const metadata = JSON.stringify({
    sessionId: "native-session",
    cwd: "/allowed",
  });
  const event = JSON.stringify({
    uuid: "stable-event",
    role: "user",
    text: "original decision",
  });
  await writeFile(file, metadata + "\n" + event + "\n" + event + "\n");
  await collect(
    { ...config(), roots: [{ client: "claude", path: root }] },
    state,
    t.request,
    async () => {},
    t.transfer,
  );
  while (await processUpload(owner, new AbortController().signal)) {}
  const result = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT result FROM collection_uploads WHERE manifest->>'sessionId'='native-session' AND status='completed' ORDER BY created_at DESC LIMIT 1",
      ),
    )
  ).rows[0].result;
  assert.equal(result.accepted, 2);
  assert.equal(result.duplicate, 1);
  await writeFile(
    file,
    metadata +
      "\n" +
      JSON.stringify({ uuid: "new-event", text: "inserted" }) +
      "\n" +
      event +
      "\n",
  );
  await collect(
    { ...config(), roots: [{ client: "claude", path: root }] },
    state,
    t.request,
    async () => {},
    t.transfer,
  );
  while (await processUpload(owner, new AbortController().signal)) {}
  await collect(
    { ...config(), roots: [{ client: "claude", path: root }] },
    state,
    t.request,
    async () => {},
    t.transfer,
  );
  while (await processUpload(owner, new AbortController().signal)) {}
  const shifted = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT result FROM collection_uploads WHERE manifest->>'sessionId'='native-session' AND status='completed' ORDER BY created_at DESC LIMIT 1",
      ),
    )
  ).rows[0].result;
  assert.equal(shifted.accepted, 1);
  assert.equal(shifted.duplicate, 2);
});

test("an interrupted upload keeps its exact range when new messages are appended", async () => {
  while (await processUpload(owner, new AbortController().signal)) {}
  const dir = join(root, "resume");
  await mkdir(dir);
  const file = join(dir, "session.jsonl"),
    state = { files: {} },
    t = transport();
  const c = { ...config(), roots: [{ client: "claude", path: dir }] };
  await writeFile(
    file,
    JSON.stringify({
      sessionId: "resume-session",
      cwd: "/allowed",
      text: "first",
    }) + "\n",
  );
  const initial = (await stat(file)).size;
  assert.equal(
    (
      await collect(
        c,
        state,
        t.request,
        async () => {},
        async () => {
          throw new Error("offline");
        },
      )
    ).failed,
    1,
  );
  await appendFile(
    file,
    JSON.stringify({ uuid: "added", text: "appended" }) + "\n",
  );
  await collect(c, state, t.request, async () => {}, t.transfer);
  assert.equal(t.manifests.length, 2);
  assert.equal(t.manifests[1].end, initial);
  assert.deepEqual(t.manifests[1], t.manifests[0]);
  while (await processUpload(owner, new AbortController().signal)) {}
  await collect(c, state, t.request, async () => {}, t.transfer);
  assert.equal(t.manifests[2].start, initial);
  assert.equal(t.manifests[2].recordEnd, 2);
  while (await processUpload(owner, new AbortController().signal)) {}
});

test("split L1 resolves exact evidence without reading an image or permanent gzip copy", async () => {
  const file = join(root, "image-separated.jsonl");
  await writeFile(
    file,
    JSON.stringify({
      type: "session_meta",
      payload: { id: "image-separated", cwd: "/allowed" },
    }) +
      "\n" +
      JSON.stringify({
        role: "user",
        content: [
          { type: "text", text: "이미지 대신 텍스트만 정제한다." },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "A".repeat(100000),
            },
          },
        ],
      }) +
      "\n",
  );
  const t = transport();
  await collect(config(), { files: {} }, t.request, async () => {}, t.transfer);
  while (await processUpload(owner, new AbortController().signal)) {}
  const upload = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT id,manifest FROM collection_uploads WHERE workspace_id=$1 AND manifest->>'sessionId'='image-separated'",
        [ws],
      ),
    )
  ).rows[0];
  assert.equal(upload.manifest.maskVersion, "stream-mask-2");
  assert.ok(upload.manifest.parts.some((p: any) => p.kind === "image"));
  for (let i = 0; i < upload.manifest.parts.length; i++)
    if (upload.manifest.parts[i].kind === "image")
      await deleteBlob(`raw/${ws}/${upload.id}/${i}.zst`);
  const sources = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT * FROM sources WHERE workspace_id=$1 AND metadata->>'rawUploadId'=$2",
        [ws, upload.id],
      ),
    )
  ).rows;
  assert.ok(sources.length);
  const texts = [];
  for (const source of sources) {
    assert.ok(source.object_key.endsWith(".ref.zst"));
    const text = await getSource(source.object_key);
    assert.equal(hash(text), source.content_hash);
    texts.push(text);
    const info = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws}/source-records/${source.id}/info`,
      headers,
    });
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().text, undefined);
  }
  assert.ok(texts.join("").includes("이미지 대신 텍스트만 정제한다."));
  assert.ok(!texts.join("").includes("A".repeat(100)));
});

test("image-heavy sessions split at event boundaries and resume from the verified cursor", async () => {
  const dir = join(root, "many-images");
  await mkdir(dir);
  const file = join(dir, "many.jsonl");
  const records = Array.from(
    { length: 130 },
    (_, i) =>
      JSON.stringify({
        cwd: "/allowed",
        sessionId: "many-images",
        role: "user",
        text: "record " + i,
        image:
          "data:image/png;base64," +
          Buffer.from("synthetic image " + i).toString("base64"),
      }) + "\n",
  );
  await writeFile(file, records.join(""));
  const state = { files: {} };
  const t = transport();
  const scope = { ...config(), roots: [{ client: "codex", path: dir }] };
  const first = await collect(
    scope,
    state,
    t.request,
    async () => {},
    t.transfer,
  );
  assert.equal(first.failed, 0);
  assert.equal(t.manifests.length, 1);
  assert.ok(t.manifests[0].parts.length <= 128);
  assert.ok(t.manifests[0].end < (await stat(file)).size);
  assert.equal(
    records.slice(0, t.manifests[0].recordEnd).join("").length,
    t.manifests[0].end,
  );
  while (await processUpload(owner, new AbortController().signal)) {}
  const second = await collect(
    scope,
    state,
    t.request,
    async () => {},
    t.transfer,
  );
  assert.equal(second.failed, 0);
  assert.equal(t.manifests[1].start, t.manifests[0].end);
  assert.equal(t.manifests[1].recordStart, t.manifests[0].recordEnd);
  assert.equal(t.manifests[1].end, (await stat(file)).size);
  assert.equal(t.manifests[1].recordEnd, 130);
  while (await processUpload(owner, new AbortController().signal)) {}
  const last = await collect(
    scope,
    state,
    t.request,
    async () => {},
    t.transfer,
  );
  assert.equal(last.failed, 0);
  assert.equal(t.manifests.length, 2);
  assert.equal((state.files as any)[file].end, (await stat(file)).size);
});

test("every source reference keeps its cumulative projection offset across batches", async () => {
  const dir = join(root, "reference-offsets");
  await mkdir(dir);
  const file = join(dir, "many.jsonl");
  await writeFile(
    file,
    Array.from(
      { length: 80 },
      (_, i) =>
        JSON.stringify({
          cwd: "/allowed",
          sessionId: "reference-offsets",
          role: "user",
          text: ("한글 맥락 " + i + " ").repeat(200),
        }) + "\n",
    ).join(""),
  );
  const t = transport();
  const result = await collect(
    { ...config(), roots: [{ client: "codex", path: dir }] },
    { files: {} },
    t.request,
    async () => {},
    t.transfer,
  );
  assert.equal(result.failed, 0);
  while (await processUpload(owner, new AbortController().signal)) {}
  const sources = (
    await tx(owner, ws, (c) =>
      c.query(
        "SELECT object_key,content_hash,line_count FROM sources WHERE workspace_id=$1 AND origin='codex:reference-offsets'",
        [ws],
      ),
    )
  ).rows;
  assert.ok(sources.length >= 3);
  for (const source of sources) {
    const text = await getSource(source.object_key);
    assert.equal(hash(text), source.content_hash);
    assert.equal(text.split("\n").length, source.line_count);
  }
});
