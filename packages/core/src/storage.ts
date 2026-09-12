import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as common from "oci-common";
import * as objectstorage from "oci-objectstorage";
let client: Promise<objectstorage.ObjectStorageClient> | undefined;
async function ociClient() {
  return (client ??=
    new common.InstancePrincipalsAuthenticationDetailsProviderBuilder()
      .build()
      .then(
        (authenticationDetailsProvider) =>
          new objectstorage.ObjectStorageClient({
            authenticationDetailsProvider,
          }),
      ));
}
export function mask(text: string) {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[PRIVATE_KEY_REDACTED]",
    )
    .replace(
      /\b(?:aw_[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|nvapi-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,})\b/g,
      "[TOKEN_REDACTED]",
    )
    .replace(
      /((?:password|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    );
}
export function hash(text: string | Buffer) {
  return createHash("sha256").update(text).digest("hex");
}
function localPath(key: string) {
  if (!/^[a-f0-9-]+\/[a-f0-9]+\.txt\.gz$/.test(key))
    throw new Error("Invalid object key");
  return path.join(process.env.LOCAL_SOURCE_DIR ?? ".runtime/sources", key);
}
export async function putSource(key: string, text: string) {
  const body = gzipSync(Buffer.from(text));
  if (process.env.SOURCE_STORAGE === "local") {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, { mode: 0o600 });
    return;
  }
  const c = await ociClient();
  await c.putObject({
    namespaceName: process.env.OCI_NAMESPACE!,
    bucketName: process.env.OCI_BUCKET!,
    objectName: key,
    putObjectBody: body,
    contentType: "application/gzip",
  });
}
export async function getSource(key: string) {
  let buffer: Buffer;
  if (process.env.SOURCE_STORAGE === "local")
    buffer = await readFile(localPath(key));
  else {
    const c = await ociClient();
    const response = await c.getObject({
      namespaceName: process.env.OCI_NAMESPACE!,
      bucketName: process.env.OCI_BUCKET!,
      objectName: key,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.value as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error("Source too large");
      chunks.push(Buffer.from(chunk));
    }
    buffer = Buffer.concat(chunks);
  }
  return gunzipSync(buffer, { maxOutputLength: 2 * 1024 * 1024 }).toString(
    "utf8",
  );
}

export function maskRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskRecord);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(?:password|secret|api[_-]?key|access[_-]?token|authorization|private[_-]?key)$/i.test(
          k,
        )
          ? "[REDACTED]"
          : maskRecord(v),
      ]),
    );
  return typeof value === "string"
    ? mask(value).replace(
        /https:\/\/hooks\.slack\.com\/services\/[^\s"'<>]+/g,
        "[WEBHOOK_REDACTED]",
      )
    : value;
}
