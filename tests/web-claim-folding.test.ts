import { test } from "node:test";
import assert from "node:assert/strict";
import { foldClaims, claimKeyOf } from "../apps/agent-wiki-web/lib/clusters.js";
import { claimKey } from "../packages/core/src/wiki-page.js";
// The list on screen folds support clusters by looking each membership string
// up in its own map. The first version built that map with a different
// separator than the snapshot writes, so every lookup missed: the page text
// folded, the list did not, and nothing failed. Synthetic data only; the
// production numbers live in docs/OPERATIONS.md.
const claim = (anchor: string, state = "current") => ({
  article_id: "11111111-1111-4111-8111-111111111111",
  revision: 1,
  anchor,
  state,
  text: "본문 " + anchor,
});
test("the web and the snapshot agree on how a claim is identified", () => {
  const c = claim("x");
  assert.equal(claimKeyOf(c), claimKey(c));
});
test("a snapshot cluster folds its members out of the list", () => {
  const claims = [claim("rep"), claim("echo-a"), claim("echo-b"), claim("alone")];
  const folded = foldClaims(claims, [
    {
      representative: claimKeyOf(claim("rep")),
      members: [claimKeyOf(claim("echo-a")), claimKeyOf(claim("echo-b"))],
    },
    { representative: claimKeyOf(claim("alone")), members: [] },
  ]);
  assert.deepEqual(
    folded.rows.map((c) => c.anchor),
    ["rep", "alone"],
  );
  assert.equal(folded.foldedCount, 2);
  assert.deepEqual(
    folded.membersOf.get(claimKeyOf(claim("rep")))?.map((c) => c.anchor),
    ["echo-a", "echo-b"],
  );
});
test("membership written in any other format folds nothing", () => {
  const claims = [claim("rep"), claim("echo")];
  const wrong = foldClaims(claims, [
    {
      representative: "11111111-1111-4111-8111-111111111111|1|rep",
      members: ["11111111-1111-4111-8111-111111111111|1|echo"],
    },
  ]);
  assert.equal(
    wrong.foldedCount,
    0,
    "this is what the separator mismatch looked like: silently no folding",
  );
  assert.equal(wrong.rows.length, 2);
});
test("a Version with no clusters draws flat, and only current claims fold", () => {
  const claims = [claim("a"), claim("old", "superseded")];
  assert.deepEqual(
    foldClaims(claims, undefined).rows.map((c) => c.anchor),
    ["a"],
  );
  const withSuperseded = foldClaims(claims, [
    { representative: claimKeyOf(claim("a")), members: [claimKeyOf(claim("old"))] },
  ]);
  assert.equal(
    withSuperseded.foldedCount,
    0,
    "a superseded claim is not in the list to begin with",
  );
});
