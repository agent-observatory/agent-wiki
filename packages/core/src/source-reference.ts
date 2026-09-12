import { mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { getBlob, hash } from "./storage.js";
import { projectEvents } from "./projection.js";

export type SourceReference = {
  workspace: string;
  upload: string;
  start: number;
  count: number;
};
// The immutable reference selects evidence lines from the canonical text archive.
// No permanent gzip projection is created. Only a requested source is returned.
export async function readSourceReference(ref: SourceReference) {
  const manifest = JSON.parse(
    zstdDecompressSync(
      await getBlob(`raw-meta/${ref.workspace}/${ref.upload}/0.zst`),
      { maxOutputLength: 8 * 1024 * 1024 },
    ).toString(),
  );
  const accepted = new Set(manifest.accepted as number[]);
  async function* bytes() {
    for (const p of manifest.parts) {
      if (p.kind !== "text") continue;
      const compressed = await getBlob(
        `raw/${ref.workspace}/${ref.upload}/${p.index}.zst`,
        p.compressedBytes,
      );
      if (hash(compressed) !== p.compressedHash)
        throw new Error("SOURCE_HASH_MISMATCH");
      const raw = zstdDecompressSync(compressed, { maxOutputLength: p.bytes });
      if (hash(raw) !== p.hash) throw new Error("SOURCE_HASH_MISMATCH");
      yield raw;
    }
  }
  const dir = await mkdtemp(join(tmpdir(), "wiki-source-view-"));
  const lines: string[] = [];
  let position = 0;
  try {
    for await (const event of projectEvents(
      bytes(),
      dir,
      manifest.recordStart,
    )) {
      if (!accepted.has(event.position)) continue;
      let count = 0;
      for await (const line of createInterface({
        input: createReadStream(event.file),
        crlfDelay: Infinity,
      })) {
        count++;
        if (position++ >= ref.start) lines.push(line);
        if (lines.length === ref.count) return lines.join("\n");
      }
      if (!count) {
        if (position++ >= ref.start)
          lines.push(
            JSON.stringify({
              event: event.position,
              text: "[NO_TEXT_FIELDS]",
              imageAnalysis: "skipped",
            }),
          );
        if (lines.length === ref.count) return lines.join("\n");
      }
    }
    throw new Error("SOURCE_RANGE_MISMATCH");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
