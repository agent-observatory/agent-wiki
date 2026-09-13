import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { open } from "node:fs/promises";
import { join } from "node:path";
import Parser from "stream-json/Parser.js";
import { mask } from "./storage.js";
// Projection is deterministic and bounded. Exact raw data lives in immutable
// compressed parts; each projected line names its event/field/segment in that L1.
export async function* projectEvents(
  input: AsyncIterable<Buffer>,
  dir: string,
  start = 0,
) {
  const stream = Readable.from(input),
    parser = new Parser({
      jsonStreaming: true,
      packStrings: false,
      packNumbers: false,
      streamKeys: false,
    });
  stream.on("error", (e) => parser.destroy(e));
  stream.pipe(parser);
  let frames: any[] = [],
    pos = start,
    h = createHash("sha256"),
    file: any = null,
    filePath = "",
    keyPath = "",
    text = "",
    segment = 0,
    skip = false,
    inString = false,
    nativeId: string | null = null,
    authority: string | undefined;
  const currentPath = () =>
    frames
      .map((f) => (f.kind === "array" ? f.index : f.key))
      .filter((x) => x !== undefined);
  const advance = () => {
    const f = frames.at(-1);
    if (f?.kind === "array") f.index++;
  };
  let outputBuffer = "";
  const flushOutput = async () => {
    if (outputBuffer) await file.write(outputBuffer);
    outputBuffer = "";
  };
  const emit = async (value: string) => {
    if (value && !skip) {
      outputBuffer +=
        JSON.stringify({
          event: pos,
          ...(authority ? { authority } : {}),
          field: keyPath,
          segment: segment++,
          text: mask(value),
        }) + "\n";
      if (Buffer.byteLength(outputBuffer) >= 65536) await flushOutput();
    }
  };
  try {
    for await (const t of parser) {
      if (!file) {
        if (t.name !== "startObject") throw new Error("INVALID_SESSION_RECORD");
        filePath = join(dir, String(pos));
        file = await open(filePath, "w", 0o600);
        h = createHash("sha256");
        nativeId = null;
        authority = undefined;
      }
      // Provenance may move when another machine stores the same selected item.
      // Its content-addressed ID/payload remain the dedup identity; raw bytes and
      // projected evidence are independently verified by upload/source hashes.
      const rootField =
        t.name === "keyValue" && frames.length === 1
          ? t.value
          : currentPath()[0];
      const provenance = ["provenance", "timestamp"].includes(rootField);
      if (!provenance && (t.name === "stringChunk" || t.name === "numberChunk"))
        h.update(t.value);
      else if (!provenance) {
        h.update("|" + t.name + "|");
        if (t.value !== undefined) h.update(String(t.value));
      }
      if (t.name === "keyValue") frames.at(-1).key = t.value;
      else if (t.name === "startObject" || t.name === "startArray")
        frames.push({
          kind: t.name === "startArray" ? "array" : "object",
          index: 0,
        });
      else if (t.name === "startString" || t.name === "startNumber") {
        keyPath = JSON.stringify(currentPath());
        text = "";
        segment = 0;
        inString = true;
        skip =
          /(?:image|image_url|image_data|base64|password|secret|authorization|api_key|access_token|private_key)/i.test(
            keyPath,
          ) ||
          (currentPath().at(-1) === "data" && frames.some((f) => f.image));
      } else if (
        (t.name === "stringChunk" || t.name === "numberChunk") &&
        inString &&
        !skip
      ) {
        text += t.value;
        if (text.startsWith("data:image/")) {
          skip = true;
          text = "";
        }
        while (text.length > 384) {
          let n = 384;
          if (/[\uD800-\uDBFF]/.test(text[n - 1])) n--;
          await emit(text.slice(0, n));
          text = text.slice(n);
        }
      } else if (t.name === "endString" || t.name === "endNumber") {
        if (
          ['["uuid"]', '["id"]'].includes(keyPath) &&
          text.length <= 200 &&
          segment === 0
        )
          nativeId = text;
        if (
          currentPath().at(-1) === "type" &&
          ["image", "input_image", "image_url", "base64"].includes(text)
        )
          frames.at(-1).image = true;
        if (
          keyPath === '["provenance","authority"]' &&
          text === "derived_context"
        )
          authority = text;
        await emit(text);
        text = "";
        inString = false;
        advance();
      } else if (["nullValue", "trueValue", "falseValue"].includes(t.name)) {
        keyPath = JSON.stringify(currentPath());
        segment = 0;
        skip = false;
        await emit(String(t.value));
        advance();
      } else if (t.name === "endObject" || t.name === "endArray") {
        frames.pop();
        advance();
        if (!frames.length) {
          await flushOutput();
          await file.close();
          file = null;
          yield {
            position: pos++,
            contentHash: h.digest("hex"),
            nativeId,
            file: filePath,
          };
        }
      }
    }
  } finally {
    stream.destroy();
    parser.destroy();
    if (file) await file.close();
  }
}
