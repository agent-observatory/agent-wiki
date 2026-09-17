import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderWikiPage,
  supportClusters,
  type PageClaim,
} from "../packages/core/src/wiki-page.js";
const a: PageClaim = {
  article_id: "a",
  revision: 1,
  anchor: "provider",
  text: "이전 제공자는 NVIDIA다.",
  type: "user_decision",
  scope: "general",
  subject: "provider",
  state: "superseded",
  title: "이전 제공자",
};
const b = {
  ...a,
  article_id: "b",
  text: "호출 지연 때문에 Alibaba로 변경한다.",
  state: "current",
  title: "제공자 변경",
};
test("topic page keeps current explanations, uncertainty and explicit decision history apart", () => {
  const page = renderWikiPage(
    "AI 정제",
    [
      a,
      b,
      {
        ...b,
        article_id: "c",
        state: "proposed",
        text: "모델 변경을 검토한다.",
      },
    ],
    [
      {
        from_article_id: "b",
        from_revision: 1,
        from_anchor: "provider",
        to_article_id: "a",
        to_revision: 1,
        to_anchor: "provider",
        relation: "supersedes",
      },
    ],
    "/knowledge",
  );
  assert.ok(page.indexOf(b.text) < page.indexOf(a.text));
  assert.match(page, /미해결 사항 · Proposed · Unconfirmed · Conflicted/);
  assert.match(page, /Decision History/);
  assert.match(page, /revision=1&tab=evidence#provider/);
  assert.match(page, /호출 지연 때문에/);
});

test("cross-topic history links remain visible without importing another topic as current content", () => {
  const page = renderWikiPage(
    "AI",
    [b],
    [
      {
        from_article_id: "b",
        from_revision: 1,
        from_anchor: "provider",
        to_article_id: "a",
        to_revision: 1,
        to_anchor: "provider",
        relation: "supersedes",
      },
    ],
    "/knowledge",
    [a],
  );
  assert.match(page, /Decision History/);
  assert.match(page, /이전 제공자/);
  assert.ok(!page.includes(a.text));
});

// Consolidation's dominant verdict is `supports`: 143 of 157 relations in
// production, and the page printed every member of a chain, so the reader saw
// the same assertion several times over. Folding must be deterministic — the
// model proposed the edges, engineering picks the representative.
const cluster = (over: Partial<PageClaim> & { anchor: string }): PageClaim => ({
  article_id: "x",
  revision: 1,
  text: "본문 " + over.anchor,
  type: "observation",
  subject: "database-hosting",
  scope: "production",
  state: "current",
  title: "제목 " + over.anchor,
  ...over,
});
const supports = (from: string, to: string) => ({
  from_article_id: "x",
  from_revision: 1,
  from_anchor: from,
  to_article_id: "x",
  to_revision: 1,
  to_anchor: to,
  relation: "supports",
});
test("a support chain folds to one representative, chosen the same way whatever the row order", () => {
  const claims = [
    cluster({ anchor: "obs-a" }),
    cluster({ anchor: "obs-b" }),
    cluster({ anchor: "obs-c" }),
    cluster({ anchor: "decision", type: "user_decision" }),
    cluster({ anchor: "echo" }),
    cluster({ anchor: "alone" }),
  ];
  // {obs-a, obs-b, obs-c}: b and c restate a, so a is the original statement.
  // {decision, echo}: echo supports the decision, and authority wins anyway.
  const relations = [
    supports("obs-b", "obs-a"),
    supports("obs-c", "obs-a"),
    supports("echo", "decision"),
  ];
  const run = (cl: PageClaim[], rel: typeof relations) =>
    supportClusters(cl, rel)
      .map(
        (c) =>
          c.representative.anchor +
          "<" +
          c.members
            .map((m) => m.anchor)
            .sort()
            .join(","),
      )
      .sort();
  const expected = ["alone<", "decision<echo", "obs-a<obs-b,obs-c"];
  assert.deepEqual(run(claims, relations), expected);
  assert.deepEqual(
    run([...claims].reverse(), [...relations].reverse()),
    expected,
    "the representative does not depend on row order",
  );
});

test("a folded page prints the representative once and links the rest as corroboration", () => {
  const claims = [
    cluster({ anchor: "decision", type: "user_decision", title: "결정" }),
    cluster({ anchor: "echo", title: "같은 말" }),
  ];
  const page = renderWikiPage(
    "주제",
    claims,
    [supports("echo", "decision")],
    "/knowledge",
  );
  assert.equal(page.split("본문 echo").length - 1, 0, "the member's body is not repeated");
  assert.match(page, /본문 decision/);
  assert.match(page, /재확인 1건/);
  assert.match(page, /\[같은 말\]\(\/knowledge\/x\?revision=1&tab=evidence#echo\)/);
});

// An earlier claim that nothing supports must not be folded away by a later
// one: a superseded or unconfirmed claim is not a cluster node at all.
test("only current claims form clusters", () => {
  const claims = [
    cluster({ anchor: "now" }),
    cluster({ anchor: "old", state: "superseded" }),
  ];
  const clusters = supportClusters(claims, [supports("old", "now")]);
  assert.deepEqual(
    clusters.map((c) => [c.representative.anchor, c.members.length]),
    [["now", 0]],
  );
});
