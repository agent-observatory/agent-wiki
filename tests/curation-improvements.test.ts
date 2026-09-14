import { test } from "node:test";
import assert from "node:assert/strict";
import { callModel, defaults } from "../packages/core/src/ai.js";
import { sourceRecordTimes } from "../packages/core/src/evidence-time.js";
import { expandProposalContent } from "../apps/agent-wiki-worker/src/curation-proposal.js";
import { changeInput } from "../apps/agent-wiki-api/src/knowledge.js";
import {
  renderWikiPage,
  type PageClaim,
} from "../packages/core/src/wiki-page.js";

test("Alibaba exhaustion is distinguished from auth/rate/unknown 403 without logging provider text", async () => {
  const original = globalThis.fetch;
  try {
    // [status, body, expected code, expected providerError (undefined = skip check)]
    for (const [status, body, expected, providerError] of [
      [
        403,
        {
          error: {
            code: "AllocationQuota.FreeTierOnly",
            message: "never log this",
          },
        },
        "AI_FREE_QUOTA_EXHAUSTED",
        { code: "AllocationQuota.FreeTierOnly", type: undefined },
      ],
      [
        403,
        { code: "AllocationQuota.FreeTierOnly" },
        "AI_FREE_QUOTA_EXHAUSTED",
        undefined,
      ],
      [
        403,
        { error: { code: "AccessDenied" } },
        "AI_HTTP_403",
        { code: "AccessDenied", type: undefined },
      ],
      [429, { error: { code: "AllocationQuota.FreeTierOnly" } }, "AI_HTTP_429", undefined],
      [403, "x".repeat(20000), "AI_HTTP_403", { code: "unparsed", type: "unparsed" }],
      // Real body observed 2026-09-14 against a genuinely exhausted account:
      // the OpenAI-compatible endpoint uses "insufficient_quota", not the
      // native API's "AllocationQuota.FreeTierOnly".
      [
        403,
        {
          error: {
            type: "insufficient_quota",
            code: "insufficient_quota",
            message: "never log this",
          },
        },
        "AI_FREE_QUOTA_EXHAUSTED",
        { code: "insufficient_quota", type: "insufficient_quota" },
      ],
      [
        403,
        { error: { type: "insufficient_quota" } },
        "AI_FREE_QUOTA_EXHAUSTED",
        { code: undefined, type: "insufficient_quota" },
      ],
      // Same code at 429 is a rate/token limit, not exhaustion: must stay
      // retryable, never trigger the fallback switch or the safety stop.
      [
        429,
        { error: { code: "insufficient_quota" } },
        "AI_HTTP_429",
        { code: "insufficient_quota", type: undefined },
      ],
      [
        403,
        { error: { code: "bad code <script>" } },
        "AI_HTTP_403",
        { code: "unparsed", type: undefined },
      ],
    ] as const) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify(body), { status });
      await assert.rejects(
        callModel(
          {
            ...defaults,
            ...defaults.primary,
            provider: "openai-compatible",
            baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            model: "deepseek-v4-flash",
          },
          "synthetic",
          [],
          AbortSignal.timeout(500),
        ),
        (e: any) => {
          assert.equal(e.code, expected);
          assert.ok(!e.message.includes("never log"));
          if (providerError !== undefined)
            assert.deepEqual(e.providerError, providerError);
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("a non-Alibaba host's 403 never reads the body for a provider code", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), {
        status: 403,
      });
    await assert.rejects(
      callModel(
        {
          ...defaults,
          ...defaults.primary,
          provider: "openai-compatible",
          baseUrl: "https://api.deepseek.com/v1",
        },
        "synthetic",
        [],
        AbortSignal.timeout(500),
      ),
      (e: any) => {
        assert.equal(e.code, "AI_HTTP_403");
        assert.equal(e.providerError, null);
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("evidence dates use event structure; recovery time and absent dates are never original utterance times", () => {
  const row = (event: number, field: string[], text: string) =>
    JSON.stringify({ event, field: JSON.stringify(field), text });
  const text = [
    row(1, ["payload", "text"], "원래 발언"),
    row(1, ["timestamp"], "2026-09-12T00:00:00Z"),
    row(2, ["payload", "text"], "복구된 발언"),
    row(2, ["timestamp"], "2026-09-14T00:00:00Z"),
    row(2, ["provenance", "kind"], "compaction_recovered"),
    row(3, ["payload", "text"], "timestamp: 2026-09-01T00:00:00Z"),
  ].join("\n");
  const dates = sourceRecordTimes(text);
  assert.equal(dates.find((t) => t.line === 1)?.kind, "recorded");
  assert.equal(dates.find((t) => t.line === 3)?.kind, "recovered");
  assert.equal(
    dates.find((t) => t.line === 6),
    undefined,
  );
  const base: PageClaim = {
    article_id: "a",
    revision: 1,
    anchor: "x",
    text: "설명",
    title: "같은 제목",
    type: "user_decision",
    subject: "provider",
    scope: "curation",
    state: "current",
  };
  const page = renderWikiPage(
    "주제",
    [
      {
        ...base,
        evidence_times: [{ at: "2026-09-14T00:00:00Z", kind: "recovered" }],
      },
      { ...base, anchor: "y", text: "다른 설명" },
    ],
    [],
    "/knowledge",
  );
  assert.equal(page.split("### 같은 제목").length - 1, 1);
  assert.match(page, /복구 기록 2026/);
  assert.match(page, /시각 미확인/);
});

test("model emits claim text once; server composes content and retains strict field validation", () => {
  const proposal: any = expandProposalContent({
    changes: [
      {
        clientRef: "a",
        title: "설명",
        claims: [
          { anchor: "one", text: "첫 설명", type: "ai_inference" },
          { anchor: "two", text: "둘째 설명", type: "unconfirmed" },
        ],
      },
    ],
  });
  assert.equal(proposal.changes[0].content, "첫 설명\n\n둘째 설명");
  assert.equal(changeInput.safeParse(proposal.changes[0]).success, true);
  const invalid: any = expandProposalContent({
    changes: [
      {
        ...proposal.changes[0],
        claims: [{ ...proposal.changes[0].claims[0], type: "proposed" }],
      },
    ],
  });
  assert.equal(changeInput.safeParse(invalid.changes[0]).success, false);
});
