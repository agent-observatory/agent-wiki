import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadUrl } from "../packages/core/src/storage.js";
test("OCI dual-stack endpoint template resolves before issuing a collector URL", () => {
  assert.equal(
    uploadUrl(
      "https://objectstorage.ap-osaka-1.{dualStack?ds.oci.:}oraclecloud.com",
      "/p/synthetic/n/ns/b/bucket/o/part",
    ),
    "https://objectstorage.ap-osaka-1.oraclecloud.com/p/synthetic/n/ns/b/bucket/o/part",
  );
  assert.throws(() => uploadUrl("https://example.org", "/p/synthetic"));
  assert.throws(() =>
    uploadUrl(
      "https://objectstorage.ap-osaka-1.oraclecloud.com",
      "//example.org/",
    ),
  );
});
