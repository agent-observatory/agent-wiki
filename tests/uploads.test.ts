import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
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
import { hash, putBlob, getSource } from "../packages/core/src/storage.js";
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
