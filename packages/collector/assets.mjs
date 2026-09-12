import { Transform } from "node:stream";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Keep JSON structure and value types intact. Only embedded image strings are
// replaced with content-addressed references; no remote image URL is fetched.
export function separateImages(dir, assets) {
  const frames = [];
  let active = false,
    probe = "",
    image = false,
    decided = false,
    file,
    digest,
    filePath;
  const advance = () => {
    if (frames.at(-1)?.array) frames.at(-1).index++;
  };
  return new Transform({
    objectMode: true,
    transform(token, _, callback) {
      const output = this;
      (async () => {
        if (token.name === "keyValue") frames.at(-1).key = token.value;
        if (token.name === "startObject" || token.name === "startArray") {
          frames.push({ array: token.name === "startArray", index: 0 });
        }
        if (token.name === "startString") {
          active = true;
          probe = "";
          decided = false;
          image = false;
          output.push(token);
          return;
        }
        if (active && token.name === "stringChunk") {
          if (!decided) {
            probe += token.value;
            if (probe.length < 16) return;
            const keys = frames
              .map((f) => f.key)
              .filter(Boolean)
              .join(".");
            image =
              probe.startsWith("data:image/") ||
              /(?:^|\.)source\.data$|(?:^|\.)(?:image_data|base64)$/.test(keys);
            decided = true;
            if (image) {
              filePath = join(dir, "image-" + assets.length);
              file = await open(filePath, "w", 0o600);
              digest = createHash("sha256");
            }
            token = { name: "stringChunk", value: probe };
            probe = "";
          }
          if (image) {
            digest.update(token.value);
            await file.write(token.value);
          } else output.push(token);
          return;
        }
        if (active && token.name === "endString") {
          if (image) {
            await file.close();
            file = undefined;
            const asset = digest.digest("hex");
            assets.push({ asset, file: filePath });
            output.push({
              name: "stringChunk",
              value: "data:image/agent-wiki;ref=" + asset,
            });
          } else if (probe) output.push({ name: "stringChunk", value: probe });
          active = false;
          advance();
        } else if (["endObject", "endArray"].includes(token.name)) {
          frames.pop();
          advance();
        } else if (
          ["endNumber", "trueValue", "falseValue", "nullValue"].includes(
            token.name,
          )
        )
          advance();
        output.push(token);
      })().then(() => callback(), callback);
    },
    destroy(error, callback) {
      Promise.resolve(file?.close()).then(() => callback(error), callback);
    },
  });
}
