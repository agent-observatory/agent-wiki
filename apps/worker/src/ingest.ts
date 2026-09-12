import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { zstdDecompressSync, zstdCompressSync } from "node:zlib";
import { tx } from "../../../packages/core/src/db.js";
import {
  getBlob,
  putBlob,
  deleteBlob,
  revokeUploadGrant,
  hash,
  putSource,
  mask,
} from "../../../packages/core/src/storage.js";
import { log } from "../../../packages/core/src/log.js";
import { projectEvents } from "../../../packages/core/src/projection.js";
export { projectEvents } from "../../../packages/core/src/projection.js";
export async function processUpload(owner: string, signal: AbortSignal) {
  const spaces = await tx(
    owner,
    null,
    async (c) =>
      (await c.query("SELECT id FROM workspaces ORDER BY created_at")).rows,
  );
  for (const space of spaces) {
    if (signal.aborted) return false;
    const ws = space.id;
    const expired = await tx(
      owner,
      ws,
      async (c) =>
        (
          await c.query(
            "SELECT id,manifest,grants FROM collection_uploads WHERE workspace_id=$1 AND status IN ('uploading','failed') AND expires_at<now() LIMIT 1",
            [ws],
          )
        ).rows[0],
    );
    if (expired) {
      try {
        for (const id of Object.values(expired.grants))
          await revokeUploadGrant(String(id));
        for (let i = 0; i < expired.manifest.parts.length; i++) {
          await deleteBlob(`staging/${ws}/${expired.id}/${i}.zst`);
          await deleteBlob(`raw/${ws}/${expired.id}/${i}.zst`);
        }
        await tx(owner, ws, (c) =>
          c.query(
            "UPDATE collection_uploads SET status='expired',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status IN ('uploading','failed')",
            [ws, expired.id],
          ),
        );
      } catch {
        log("error", "upload_cleanup_failed", { upload_id: expired.id });
      }
    }
    const upload = await tx(owner, ws, async (c) => {
      const row = (
        await c.query(
          "SELECT * FROM collection_uploads WHERE workspace_id=$1 AND (status='queued' OR (status='verifying' AND lease_until<now())) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
          [ws],
        )
      ).rows[0];
      if (!row) return null;
      await c.query(
        "UPDATE collection_uploads SET status='verifying',lease_until=now()+interval '15 minutes',updated_at=now() WHERE id=$1",
        [row.id],
      );
      return row;
    });
    if (!upload) continue;
    const dir = await mkdtemp(join(tmpdir(), "wiki-ingest-"));
    try {
      // Revoke write grants before reading; hash-check and copy the exact bytes read.
      for (const id of Object.values(upload.grants))
        await revokeUploadGrant(String(id));
      const v = upload.manifest;
      async function* bytes() {
        const assetHashes = new Map<string, ReturnType<typeof createHash>>();
        const referencedAssets = new Set<string>();
        let referenceTail = "";
        for (let i = 0; i < v.parts.length; i++) {
          signal.throwIfAborted();
          const p = v.parts[i],
            staging = `staging/${ws}/${upload.id}/${i}.zst`,
            final = `raw/${ws}/${upload.id}/${i}.zst`;
          const compressed = await getBlob(staging, p.compressedBytes);
          if (
            compressed.length !== p.compressedBytes ||
            hash(compressed) !== p.compressedHash
          )
            throw new Error("UPLOAD_HASH_MISMATCH");
          const raw = zstdDecompressSync(compressed, {
            maxOutputLength: p.bytes,
          });
          if (raw.length !== p.bytes || hash(raw) !== p.hash)
            throw new Error("UPLOAD_HASH_MISMATCH");
          await putBlob(final, compressed);
          if (p.kind === "image") {
            if (!assetHashes.has(p.asset))
              assetHashes.set(p.asset, createHash("sha256"));
            assetHashes.get(p.asset)!.update(raw);
          } else {
            {
              const scan = referenceTail + raw.toString("utf8");
              for (const match of scan.matchAll(
                /data:image\/agent-wiki;ref=([a-f0-9]{64})/g,
              ))
                referencedAssets.add(match[1]);
              referenceTail = scan.slice(-100);
            }
            yield raw;
          }
        }
        if (
          referencedAssets.size !== assetHashes.size ||
          [...referencedAssets].some((asset) => !assetHashes.has(asset))
        )
          throw new Error("UPLOAD_ASSET_MISMATCH");
        for (const [asset, digest] of assetHashes)
          if (digest.digest("hex") !== asset)
            throw new Error("UPLOAD_HASH_MISMATCH");
      }
      const result = await tx(owner, ws, async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          ws + upload.stream_id,
        ]);
        const cursor = (
          await c.query(
            "SELECT byte_end,record_end FROM collection_origins WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
            [ws, upload.origin_id],
          )
        ).rows[0];
        if (
          Number(cursor.byte_end) !== v.start ||
          cursor.record_end !== v.recordStart
        )
          throw new Error("CURSOR_CHANGED");
        let accepted = 0,
          duplicate = 0,
          events = 0,
          sources = 0,
          lines: string[] = [],
          size = 0,
          batchId = randomUUID(),
          projectionLine = 0;
        const pendingEvents: any[] = [];
        const nativeSeen = new Set<string>();
        const flush = async () => {
          if (!lines.length) return;
          const text = lines.join("\n"),
            contentHash = hash(text),
            key =
              ws +
              "/" +
              hash(upload.id + ":" + projectionLine + ":" + contentHash) +
              ".ref.zst";
          await putSource(
            key,
            JSON.stringify({
              workspace: ws,
              upload: upload.id,
              start: projectionLine,
              count: lines.length,
            }),
          );
          projectionLine += lines.length;
          await c.query(
            "INSERT INTO sources(id,workspace_id,name,kind,origin,content_hash,payload_hash,object_key,line_count,idempotency_key,masked,metadata) VALUES($1,$2,$3,'conversation',$4,$5,$5,$6,$7,$8,true,$9)",
            [
              batchId,
              ws,
              mask(v.name),
              v.client + ":" + mask(v.sessionId),
              contentHash,
              key,
              lines.length,
              "upload-" + upload.id + "-" + sources,
              JSON.stringify({
                rawUploadId: upload.id,
                projection: "text-fields-1",
                imageAnalysis: "skipped",
                rawImages: "preserved",
                originalRange: [v.start, v.end],
              }),
            ],
          );
          await c.query(
            "INSERT INTO refinement_jobs(id,workspace_id,source_id) VALUES($1,$2,$3)",
            [randomUUID(), ws, batchId],
          );
          sources++;
          lines = [];
          size = 0;
          ((batchId = randomUUID()), (projectionLine = 0));
        };
        for await (const event of projectEvents(bytes(), dir, v.recordStart)) {
          signal.throwIfAborted();
          events++;
          const seen = (
            await c.query(
              "SELECT source_id FROM collection_events WHERE workspace_id=$1 AND stream_id=$2 AND content_hash=$4 AND (position=$3 OR ($5::text IS NOT NULL AND native_id=$5))",
              [
                ws,
                upload.stream_id,
                event.position,
                event.contentHash,
                event.nativeId,
              ],
            )
          ).rows[0];
          const nativeKey = event.nativeId
            ? JSON.stringify([event.nativeId, event.contentHash])
            : null;
          if (seen || (nativeKey && nativeSeen.has(nativeKey))) {
            duplicate++;
            continue;
          }
          if (nativeKey) nativeSeen.add(nativeKey);
          let firstId: string | undefined;
          for await (const line of createInterface({
            input: createReadStream(event.file),
            crlfDelay: Infinity,
          })) {
            if (size + Buffer.byteLength(line) > 131072) await flush();
            firstId ??= batchId;
            lines.push(line);
            size += Buffer.byteLength(line) + 1;
          }
          if (!firstId) {
            firstId = batchId;
            const line = JSON.stringify({
              event: event.position,
              text: "[NO_TEXT_FIELDS]",
              imageAnalysis: "skipped",
            });
            lines.push(line);
            size += line.length;
          }
          pendingEvents.push([
            event.position,
            event.contentHash,
            firstId,
            event.nativeId,
          ]);
          accepted++;
        }
        await flush();
        await putBlob(
          `raw-meta/${ws}/${upload.id}/0.zst`,
          zstdCompressSync(
            Buffer.from(
              JSON.stringify({
                recordStart: v.recordStart,
                accepted: pendingEvents.map((e) => e[0]),
                parts: v.parts.map((p: any, index: number) => ({
                  ...p,
                  index,
                })),
              }),
            ),
          ),
        );
        for (const [position, contentHash, sourceId, nativeId] of pendingEvents)
          await c.query(
            "INSERT INTO collection_events(workspace_id,stream_id,position,content_hash,source_id,native_id) VALUES($1,$2,$3,$4,$5,$6)",
            [ws, upload.stream_id, position, contentHash, sourceId, nativeId],
          );
        if (events !== v.recordEnd - v.recordStart)
          throw new Error("UPLOAD_RECORD_COUNT_MISMATCH");
        const result = {
          accepted,
          duplicate,
          sources,
          end: v.end,
          recordEnd: v.recordEnd,
        };
        await c.query(
          "UPDATE collection_origins SET byte_end=$3,record_end=$4,prefix_hash=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [ws, upload.origin_id, v.end, v.recordEnd, v.prefixHash],
        );
        await c.query(
          "UPDATE collection_streams SET last_position=GREATEST(last_position,$3),updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [ws, upload.stream_id, v.recordEnd - 1],
        );
        await c.query(
          "UPDATE collection_uploads SET status='completed',result=$3,error_code=NULL,lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [ws, upload.id, JSON.stringify(result)],
        );
        return result;
      });
      for (let i = 0; i < v.parts.length; i++)
        await deleteBlob(`staging/${ws}/${upload.id}/${i}.zst`);
      log("info", "upload_completed", { upload_id: upload.id, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const code =
        /^(UPLOAD_[A-Z_]+|CURSOR_CHANGED|INVALID_SESSION_RECORD)$/.test(message)
          ? message
          : signal.aborted
            ? "INGEST_STOPPED"
            : "UPLOAD_VALIDATION_FAILED";
      await tx(owner, ws, (c) =>
        c.query(
          "UPDATE collection_uploads SET status=$3,error_code=$4,lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status<>'completed'",
          [ws, upload.id, signal.aborted ? "queued" : "failed", code],
        ),
      );
      log("error", "upload_failed", { upload_id: upload.id, error_code: code });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return true;
  }
  return false;
}
