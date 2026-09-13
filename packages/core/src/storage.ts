import { createHash } from "node:crypto";
import {
  gzipSync,
  gunzipSync,
  zstdCompressSync,
  zstdDecompressSync,
} from "node:zlib";
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
  if (!/^[a-f0-9-]+\/[a-f0-9]+\.(?:txt\.gz|ref\.zst)$/.test(key))
    throw new Error("Invalid object key");
  return path.join(process.env.LOCAL_SOURCE_DIR ?? ".runtime/sources", key);
}
export async function putSource(key: string, text: string) {
  const body = key.endsWith(".ref.zst")
    ? zstdCompressSync(Buffer.from(text))
    : gzipSync(Buffer.from(text));
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
    contentType: key.endsWith(".ref.zst")
      ? "application/zstd"
      : "application/gzip",
  });
}
async function sourceBuffer(key: string) {
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
  return buffer;
}
export async function getSource(key: string) {
  return (await getSources([key]))[0];
}
export async function getSources(keys: string[]) {
  const { readSourceReferences } = await import("./source-reference.js");
  const result: string[] = new Array(keys.length);
  const groups = new Map<
    string,
    { index: number; ref: import("./source-reference.js").SourceReference }[]
  >();
  for (const [index, key] of keys.entries()) {
    const buffer = await sourceBuffer(key);
    if (key.endsWith(".ref.zst")) {
      const ref = JSON.parse(
        zstdDecompressSync(buffer, { maxOutputLength: 4096 }).toString(),
      );
      const group = JSON.stringify([ref.workspace, ref.upload]);
      groups.set(group, [...(groups.get(group) ?? []), { index, ref }]);
    } else
      result[index] = gunzipSync(buffer, {
        maxOutputLength: 2 * 1024 * 1024,
      }).toString("utf8");
  }
  for (const group of groups.values()) {
    const texts = await readSourceReferences(group.map((x) => x.ref));
    group.forEach((x, i) => {
      result[x.index] = texts[i];
    });
  }
  return result;
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

// Upload URLs only address staging objects. Final keys are never exposed for writes.
function blobPath(key: string) {
  if (!/^(?:staging|raw|raw-meta)\/[a-f0-9-]+\/[a-f0-9-]+\/\d+\.zst$/.test(key))
    throw new Error("Invalid upload key");
  return path.join(process.env.LOCAL_SOURCE_DIR ?? ".runtime/sources", key);
}
export async function putBlob(key: string, body: Buffer) {
  if (process.env.SOURCE_STORAGE === "local") {
    const file = blobPath(key);
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
    contentType: "application/zstd",
  });
}
export async function getBlob(key: string, limit = 5 * 1024 * 1024) {
  let input: AsyncIterable<Uint8Array>;
  if (process.env.SOURCE_STORAGE === "local") {
    const { createReadStream } = await import("node:fs");
    input = createReadStream(blobPath(key));
  } else {
    const c = await ociClient();
    const r = await c.getObject({
      namespaceName: process.env.OCI_NAMESPACE!,
      bucketName: process.env.OCI_BUCKET!,
      objectName: key,
    });
    input = r.value as AsyncIterable<Uint8Array>;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size > limit) throw new Error("UPLOAD_SIZE_MISMATCH");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function deleteBlob(key: string) {
  if (process.env.SOURCE_STORAGE === "local") {
    const { rm } = await import("node:fs/promises");
    await rm(blobPath(key), { force: true });
    return;
  }
  const c = await ociClient();
  try {
    await c.deleteObject({
      namespaceName: process.env.OCI_NAMESPACE!,
      bucketName: process.env.OCI_BUCKET!,
      objectName: key,
    });
  } catch (e: any) {
    if (e.statusCode !== 404) throw e;
  }
}
export function uploadUrl(endpoint: string, accessUri: string) {
  const resolved = common.EndpointBuilder.updateEndpointTemplateForOptions(
    endpoint,
    false,
    false,
  );
  const url = new URL(resolved);
  if (
    url.protocol !== "https:" ||
    !/^objectstorage\.[a-z0-9-]+\.oraclecloud\.com$/.test(url.hostname) ||
    !accessUri.startsWith("/p/")
  )
    throw new Error("UPLOAD_ENDPOINT_INVALID");
  return url.origin + accessUri;
}
export async function createUploadGrant(key: string) {
  if (process.env.SOURCE_STORAGE === "local")
    return {
      id: "local",
      url: null,
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    };
  const c = await ociClient(),
    expiresAt = new Date(Date.now() + 900000);
  const r = await c.createPreauthenticatedRequest({
    namespaceName: process.env.OCI_NAMESPACE!,
    bucketName: process.env.OCI_BUCKET!,
    createPreauthenticatedRequestDetails: {
      name: "wiki-upload",
      objectName: key,
      accessType:
        objectstorage.models.CreatePreauthenticatedRequestDetails.AccessType
          .ObjectWrite,
      timeExpires: expiresAt,
    },
  });
  return {
    id: r.preauthenticatedRequest.id,
    url: uploadUrl(c.endpoint, r.preauthenticatedRequest.accessUri),
    expiresAt: expiresAt.toISOString(),
  };
}
export async function revokeUploadGrant(id: string) {
  if (process.env.SOURCE_STORAGE === "local" || id === "local") return;
  const c = await ociClient();
  try {
    await c.deletePreauthenticatedRequest({
      namespaceName: process.env.OCI_NAMESPACE!,
      bucketName: process.env.OCI_BUCKET!,
      parId: id,
    });
  } catch (e: any) {
    if (e.statusCode !== 404) throw e;
  }
}
