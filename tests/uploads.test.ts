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
import { buildApp } from "../apps/agent-wiki-api/src/app.js";
import { pool, tx } from "../packages/core/src/db.js";
import {
  hash,
  putBlob,
  getSource,
  getSources,
  deleteBlob,
} from "../packages/core/src/storage.js";
import { processUpload } from "../apps/agent-wiki-worker/src/ingest.js";
// @ts-expect-error standalone collector module
import { collect } from "../packages/agent-wiki-client/collector/collector.mjs";
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
  assert.equal(uploads[2].result.duplicate, 2);
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
  const session = (
    await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws}/source-sessions`,
      headers,
    })
  ).json().items[0];
  const summary = (
    await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws}/source-records/${session.id}/info`,
      headers,
    })
  ).json().collection;
  assert.equal(
    summary.count,
    2,
    "duplicate machine upload is not a new collection",
  );
  assert.equal(summary.line_count, session.line_count);
  const history = (
    await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws}/source-records/${session.id}/collection-history`,
      headers,
    })
  ).json();
  assert.equal(history.items.length, 2);
  assert.equal(history.items[0].initial, false);
  assert.equal(history.items[1].initial, true);
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
  assert.equal(result.accepted, 1);
  assert.equal(result.duplicate, 0);
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
  assert.equal(shifted.duplicate, 1);
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
  assert.equal(upload.manifest.maskVersion, "stream-mask-3");
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
  const batchTexts = await getSources(sources.map((s) => s.object_key));
  assert.equal(batchTexts.length, sources.length);
  for (let i = 0; i < sources.length; i++)
    assert.equal(hash(batchTexts[i]), sources[i].content_hash);
  for (const source of sources) {
    const text = await getSource(source.object_key);
    assert.equal(hash(text), source.content_hash);
    assert.equal(text.split("\n").length, source.line_count);
  }
});

test("collection history counts committed uploads, pages newest first, and reads metadata only", async () => {
  const session = randomUUID(),
    sourceId = randomUUID();
  const otherWs = (
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers,
      payload: { name: "Other history workspace" },
    })
  ).json().id;
  await tx(owner, ws, async (c) => {
    await c.query(
      "INSERT INTO collection_streams(workspace_id,id,client,session_id,name) VALUES($1,$2,'codex',$2,'History')",
      [ws, session],
    );
    await c.query(
      "INSERT INTO collection_origins(workspace_id,stream_id,id,machine,file_id,generation) VALUES($1,$2,$2,'test','test',$3)",
      [ws, session, randomUUID()],
    );
    // 27 successful increments, two unfinished/failed uploads, and one completed
    // duplicate-only upload. An increment split into two L1 records counts once.
    for (let i = 0; i < 30; i++) {
      const upload = randomUUID(),
        date = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
      const status = i === 27 ? "queued" : i === 28 ? "failed" : "completed";
      await c.query(
        "INSERT INTO collection_uploads(id,workspace_id,stream_id,origin_id,fingerprint,manifest,compressed_bytes,status,created_at,updated_at) VALUES($1::uuid,$2,$3,$3,$1::text,'{}',1,$4,$5,$5)",
        [upload, ws, session, status, date],
      );
      if (i === 29) continue;
      for (let part = 0; part < (i === 0 ? 2 : 1); part++) {
        await c.query(
          "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked,metadata,created_at) VALUES($1::uuid,$2,'History','conversation',$3,'hash','hash','intentionally-missing-object',10,$1::text,true,$4,$5)",
          [
            i === 0 && part === 0 ? sourceId : randomUUID(),
            ws,
            "codex:" + session,
            JSON.stringify({ rawUploadId: upload }),
            date,
          ],
        );
      }
    }
  });
  const base = `/api/workspaces/${ws}/source-records/${sourceId}`;
  const get = async (path: string) => {
    const r = await app.inject({ method: "GET", url: base + path, headers });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const summary = (await get("/info")).collection;
  assert.equal(summary.count, 27);
  assert.equal(summary.line_count, 280);
  assert.equal(summary.last_collected_at, "2026-01-01T00:26:00.000Z");
  const first = await get("/collection-history");
  assert.equal(first.items.length, 25);
  assert.equal(first.pagination.hasNext, true);
  assert.ok(first.items.every((x: any) => !x.initial));
  assert.equal(first.items[0].collected_at, summary.last_collected_at);
  const second = await get("/collection-history?historyPage=2");
  assert.equal(second.items.length, 2);
  assert.equal(second.pagination.hasNext, false);
  assert.equal(second.items[1].initial, true);
  assert.equal(second.items[1].line_count, 20);
  assert.equal(
    new Set([...first.items, ...second.items].map((x: any) => x.id)).size,
    27,
  );
  assert.equal(
    (await get("/collection-history?historyPage=3")).items.length,
    0,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: base + "/collection-history?historyPage=0",
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/workspaces/${otherWs}/source-records/${sourceId}/collection-history`,
        headers,
      })
    ).statusCode,
    404,
  );
});

test("excluded-only increments advance the raw cursor without creating sources or curation jobs", async () => {
  while (await processUpload(owner, new AbortController().signal)) {}
  const dir = join(root, "telemetry-only");
  await mkdir(dir);
  const file = join(dir, "events.jsonl");
  await writeFile(
    file,
    JSON.stringify({
      type: "session_meta",
      payload: { id: "telemetry-only", cwd: "/allowed" },
    }) +
      "\n" +
      JSON.stringify({
        type: "event_msg",
        payload: { type: "token_count", tokens: 100 },
      }) +
      "\n",
  );
  const state = { files: {} };
  const t = transport();
  const cfg = { ...config(), roots: [{ client: "codex", path: dir }] };
  assert.equal(
    (await collect(cfg, state, t.request, async () => {}, t.transfer)).failed,
    0,
  );
  assert.equal(t.manifests[0].selection.selected, 0);
  await processUpload(owner, new AbortController().signal);
  await collect(cfg, state, t.request, async () => {}, t.transfer);
  assert.equal(t.manifests.length, 1);
  assert.equal((state.files as any)[file].end, (await stat(file)).size);
  const rows = await tx(owner, ws, (c) =>
    c.query(
      "SELECT count(*)::int AS n FROM sources WHERE workspace_id=$1 AND origin='codex:telemetry-only'",
      [ws],
    ),
  );
  assert.equal(rows.rows[0].n, 0);
});
