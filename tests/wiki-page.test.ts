import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderWikiPage,
  type PageClaim,
} from "../packages/core/src/wiki-page.js";
const a: PageClaim = {
  article_id: "a",
  revision: 1,
  anchor: "provider",
  text: "이전 제공자는 NVIDIA다.",
  type: "user_decision",
  scope: "curation",
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
  assert.match(page, /미해결 사항과 검토 의견/);
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
