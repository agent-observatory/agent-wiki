import { separateImages } from "./assets.mjs";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, open, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { zstdCompressSync, constants } from "node:zlib";
import Parser from "stream-json/Parser.js";
import Replace from "stream-json/filters/Replace.js";
import Stringer from "stream-json/Stringer.js";
export const sha = (data) => createHash("sha256").update(data).digest("hex");
export const PART_BYTES = 4 * 1024 * 1024;
export const MASK_VERSION = "stream-mask-2";
const sensitive =
  /(?:^|\.)(?:password|secret|api[_-]?key|access[_-]?token|authorization|private[_-]?key)$/i;
// Strings stay bounded even when a single JSON event embeds a very large image.
// Structured secrets are replaced before this transform; known literal secrets are
// masked with a look-behind window. Images are retained in L1, never sent to L2.
export function maskStrings(redact) {
  let carry = "",
    active = false,
    dropping = false;
  return new Transform({
    objectMode: true,
    transform(t, _, cb) {
      if (t.name === "startString") {
        active = true;
        carry = "";
        dropping = false;
        this.push(t);
      } else if (t.name === "stringChunk" && active) {
        if (!dropping) {
          carry += t.value;
          while (carry.length > 32768) {
            let cut = 16384;
            if (/[\uD800-\uDBFF]/.test(carry[cut - 1])) cut--;
            // Inspect the retained overlap too, so a credential crossing `cut`
            // is found before its prefix can leave this transform.
            const masked = redact(carry);
            let difference = 0;
            while (
              difference < carry.length &&
              carry[difference] === masked[difference]
            )
              difference++;
            if (
              difference < cut ||
              carry.slice(0, cut).includes("-----BEGIN ")
            ) {
              this.push({
                name: "stringChunk",
                value: "[LONG_SENSITIVE_TEXT_REDACTED]",
              });
              dropping = true;
            } else {
              this.push({ name: "stringChunk", value: carry.slice(0, cut) });
            }
            carry = carry.slice(cut);
            if (dropping) {
              carry = "";
              break;
            }
          }
        }
      } else if (t.name === "endString") {
        this.push({ name: "stringChunk", value: redact(carry) });
        this.push(t);
        active = false;
        carry = "";
      } else this.push(t);
      cb();
    },
  });
}
export async function prepareUpload(file, start, end, redact) {
  if (
    Object.entries(process.env).some(
      ([name, value]) =>
        /TOKEN|PASSWORD|SECRET|API_KEY|ENCRYPTION_KEY/.test(name) &&
        value?.length > 16000,
    )
  )
    throw new Error("SECRET_EXCEEDS_MASK_WINDOW");
  const dir = await mkdtemp(join(tmpdir(), "wiki-upload-"));
  try {
    const normalized = join(dir, "masked.jsonl"),
      assets = [];
    await pipeline(
      createReadStream(file, { start, end: end - 1 }),
      new Parser({
        jsonStreaming: true,
        packStrings: false,
        packNumbers: false,
        streamKeys: false,
      }),
      new Replace({
        filter: sensitive,
        replacement: () => [
          { name: "startString" },
          { name: "stringChunk", value: "[REDACTED]" },
          { name: "endString" },
        ],
      }),
      maskStrings(redact),
      separateImages(dir, assets),
      new Stringer({ useKeyValues: true }),
      createWriteStream(normalized, { mode: 0o600 }),
    );
    const parts = [];
    for (const input of [
      { file: normalized, kind: "text" },
      ...[...new Map(assets.map((a) => [a.asset, a])).values()].map((a) => ({
        ...a,
        kind: "image",
      })),
    ]) {
      const handle = await open(input.file, "r");
      let position = 0;
      try {
        while (true) {
          const buf = Buffer.allocUnsafe(PART_BYTES);
          let size = 0;
          while (size < buf.length) {
            const r = await handle.read(
              buf,
              size,
              buf.length - size,
              position + size,
            );
            if (!r.bytesRead) break;
            size += r.bytesRead;
          }
          if (!size) break;
          const raw = buf.subarray(0, size),
            compressed = zstdCompressSync(raw, {
              params: { [constants.ZSTD_c_compressionLevel]: 1 },
            }),
            part = parts.length;
          await writeFile(join(dir, String(part)), compressed, { mode: 0o600 });
          parts.push({
            kind: input.kind,
            ...(input.asset ? { asset: input.asset } : {}),
            hash: sha(raw),
            compressedHash: sha(compressed),
            bytes: size,
            compressedBytes: compressed.length,
          });
          position += size;
          if (parts.length > 128) throw new Error("UPLOAD_TOO_LARGE");
        }
      } finally {
        await handle.close();
      }
    }
    return {
      dir,
      parts,
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}
export async function scanFile(file, previousEnd = 0) {
  const info = await stat(file),
    h = createHash("sha256"),
    previous = createHash("sha256");
  let offset = 0,
    end = 0,
    records = 0,
    lineHasContent = false,
    prefixHash = sha("");
  // Only complete records in the bounded snapshot are acknowledged. Hash all old
  // bytes too, so preserved mtime or a changed early message cannot escape detection.
  if (!info.size)
    return { end: 0, records: 0, prefixHash, previousHash: sha("") };
  for await (const buf of createReadStream(file, { end: info.size - 1 })) {
    if (offset < previousEnd)
      previous.update(
        buf.subarray(0, Math.min(buf.length, previousEnd - offset)),
      );
    let from = 0;
    for (let i = 0; i < buf.length; i++) {
      if (![9, 10, 13, 32].includes(buf[i])) lineHasContent = true;
      if (buf[i] === 10) {
        h.update(buf.subarray(from, i + 1));
        from = i + 1;
        end = offset + i + 1;
        if (lineHasContent) records++;
        lineHasContent = false;
        prefixHash = h.copy().digest("hex");
      }
    }
    h.update(buf.subarray(from));
    offset += buf.length;
  }
  return { end, records, prefixHash, previousHash: previous.digest("hex") };
}
