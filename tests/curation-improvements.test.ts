import { test } from "node:test";
import assert from "node:assert/strict";
import { callModel, defaults } from "../packages/core/src/ai.js";
import { sourceRecordTimes } from "../packages/core/src/evidence-time.js";
import {
  expandProposalContent,
  prepareProposal,
} from "../apps/agent-wiki-worker/src/curation-proposal.js";
import { OUTPUT_RETRY_CODES } from "../apps/agent-wiki-worker/src/worker.js";
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
    scope: "general",
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
          { anchor: "two", text: "둘째 설명", type: "agent_statement" },
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

// "assistant proposal = ai_inference/proposed" was stated in the prompt and
// enforced nowhere, so a model interpretation reached the wiki as current and
// read as settled fact beside the user's own decisions. Seen in production on
// the curation-harness subject.
test("an ai_inference claim cannot be published as current", () => {
  const text = "정제 하네스는 결정적 게이트와 모델 판단을 분리한다.";
  const claim = (state: string) => ({
    anchor: "inference",
    text,
    type: "ai_inference",
    subject: "curation-harness",
    scope: "general",
    state,
    evidence: [{ recordId: "record-1" }],
  });
  const input = {
    source: {
      id: "00000000-0000-4000-8000-000000000001",
      revision: 1,
      start: 1,
      end: 1,
      text,
      roles: [],
      omittedLines: [],
      spans: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          start: 1,
          end: 1,
          offset: 0,
        },
      ],
    },
    related: [],
  };
  const result = prepareProposal(
    {
      changes: [
        {
          clientRef: "a",
          topic: { key: "harness", title: "하네스" },
          title: "제목",
          kind: "memory",
          tags: [],
          claims: [claim("current")],
          claimRelations: [],
        },
      ],
    },
    input,
    {},
  );
  assert.equal(result.changes[0].claims[0].type, "ai_inference");
  assert.equal(
    result.changes[0].claims[0].state,
    "proposed",
    "an interpretation is a proposal until someone adopts it",
  );
});

// A truncated response used to send the chunk straight to needs-attention
// while every other malformed-output error regenerated. It surfaced the moment
// a fallback model with a different output length took over in production.
test("a truncated response regenerates instead of parking the chunk", () => {
  assert.ok(
    OUTPUT_RETRY_CODES.includes("AI_OUTPUT_LIMIT"),
    "AI_OUTPUT_LIMIT is retried like AI_INVALID_JSON and AI_EMPTY_RESPONSE",
  );
  for (const code of ["AI_INVALID_JSON", "EVIDENCE_MISMATCH", "CLAIM_SCOPE_MISMATCH"])
    assert.ok(OUTPUT_RETRY_CODES.includes(code), code + " stays retried");
});

// A claim demoted to agent_statement lost every relation it proposed. Only
// supersedes/retracts need an adopted claim on the from side; supports and
// contradicts do not, and dropping those threw away the only judgements the
// pipeline had about how two claims relate.
test("demotion drops a replacement relation but keeps supports and contradicts", () => {
  const text = "어시스턴트가 결정처럼 적은 문장";
  const evidence = [{ recordId: "record-1" }];
  const target = {
    articleId: "00000000-0000-4000-8000-000000000009",
    revision: 1,
    anchor: "old",
  };
  const diagnostics: Record<string, unknown> = {};
  const result = prepareProposal(
    {
      changes: [
        {
          clientRef: "a",
          topic: { key: "demote", title: "강등" },
          title: "제목",
          kind: "memory",
          tags: [],
          claims: [
            {
              anchor: "d",
              text,
              type: "user_decision",
              subject: "database-hosting",
              scope: "production",
              state: "current",
              evidence,
            },
          ],
          claimRelations: [
            { anchor: "d", relation: "supersedes", target, evidence },
            { anchor: "d", relation: "supports", target, evidence },
            { anchor: "d", relation: "contradicts", target, evidence },
          ],
        },
      ],
    },
    {
      source: {
        id: "00000000-0000-4000-8000-000000000001",
        revision: 1,
        start: 1,
        end: 1,
        text,
        // The cited line is the assistant's, so a user_decision cannot stand.
        roles: ["assistant"],
        omittedLines: [],
        spans: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            start: 1,
            end: 1,
            offset: 0,
          },
        ],
      },
      related: [
        {
          id: target.articleId,
          revision: 1,
          anchor: "old",
          subject: "database-hosting",
          scope: "production",
        },
      ],
    },
    diagnostics,
  );
  const claim = result.changes[0].claims[0];
  assert.equal(claim.type, "agent_statement");
  assert.equal(claim.state, "unconfirmed");
  assert.deepEqual(
    result.changes[0].claimRelations.map((r: any) => r.relation).sort(),
    ["contradicts", "supports"],
    "only the relations that require an adopted claim are dropped",
  );
  assert.deepEqual(diagnostics.droppedRelations, [
    { anchor: "d", relation: "supersedes", reason: "CLAIM_REPLACEMENT_NOT_CURRENT" },
  ]);
});

// subject and scope are the relation gate, and storeClaimRelations refusing a
// cross-scope relation failed the whole publish — so one bad relation threw
// away every claim in the chunk. One production chunk burned seven calls
// regenerating and proposing it again before being parked, losing its claims.
test("a relation whose ends disagree on scope is dropped, not allowed to fail the chunk", () => {
  const text = "범위가 다른 대상에 관계를 건 주장";
  const evidence = [{ recordId: "record-1" }];
  const target = {
    articleId: "00000000-0000-4000-8000-000000000009",
    revision: 1,
    anchor: "old",
  };
  const diagnostics: Record<string, unknown> = {};
  const result = prepareProposal(
    {
      changes: [
        {
          clientRef: "a",
          topic: { key: "scope-drop", title: "범위" },
          title: "제목",
          kind: "memory",
          tags: [],
          claims: [
            {
              anchor: "d",
              text,
              type: "observation",
              subject: "database-hosting",
              scope: "production",
              state: "current",
              evidence,
            },
          ],
          claimRelations: [
            { anchor: "d", relation: "supports", target, evidence },
          ],
        },
      ],
    },
    {
      source: {
        id: "00000000-0000-4000-8000-000000000001",
        revision: 1,
        start: 1,
        end: 1,
        text,
        roles: ["tool"],
        omittedLines: [],
        spans: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            start: 1,
            end: 1,
            offset: 0,
          },
        ],
      },
      // Same subject, different scope: the gate can never let this through and
      // it can never become valid later either.
      related: [
        {
          id: target.articleId,
          revision: 1,
          anchor: "old",
          subject: "database-hosting",
          scope: "local",
        },
      ],
    },
    diagnostics,
  );
  assert.equal(result.changes[0].claims.length, 1, "the claim survives");
  assert.deepEqual(result.changes[0].claimRelations, []);
  assert.deepEqual(diagnostics.droppedRelations, [
    { anchor: "d", relation: "supports", reason: "CLAIM_SCOPE_MISMATCH" },
  ]);
});

// A relation may only cite evidence the FROM claim already carries. The server
// refusal failed the whole publish and parked the chunk on the FIRST
// occurrence — the claims went with it, and nothing even retried.
test("a relation citing evidence its claim does not have is dropped, not fatal", () => {
  const text = "근거가 어긋난 관계를 단 주장";
  const target = {
    articleId: "00000000-0000-4000-8000-000000000009",
    revision: 1,
    anchor: "old",
  };
  const diagnostics: Record<string, unknown> = {};
  const result = prepareProposal(
    {
      changes: [
        {
          clientRef: "a",
          topic: { key: "evidence-drop", title: "근거" },
          title: "제목",
          kind: "memory",
          tags: [],
          claims: [
            {
              anchor: "d",
              text,
              type: "observation",
              subject: "database-hosting",
              scope: "production",
              state: "current",
              evidence: [{ recordId: "record-1" }],
            },
          ],
          claimRelations: [
            {
              anchor: "d",
              relation: "supports",
              target,
              // A different line of the same source: valid as a citation, but
              // not one this claim carries.
              evidence: [{ recordId: "record-2" }],
            },
          ],
        },
      ],
    },
    {
      source: {
        id: "00000000-0000-4000-8000-000000000001",
        revision: 1,
        start: 1,
        end: 2,
        text: text + "\n두 번째 줄",
        roles: ["tool", "tool"],
        omittedLines: [],
        spans: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            start: 1,
            end: 2,
            offset: 0,
          },
        ],
      },
      related: [
        {
          id: target.articleId,
          revision: 1,
          anchor: "old",
          subject: "database-hosting",
          scope: "production",
        },
      ],
    },
    diagnostics,
  );
  assert.equal(result.changes[0].claims.length, 1, "the claim survives");
  assert.deepEqual(result.changes[0].claimRelations, []);
  assert.deepEqual(diagnostics.droppedRelations, [
    {
      anchor: "d",
      relation: "supports",
      reason: "CLAIM_RELATION_EVIDENCE_REQUIRED",
    },
  ]);
});
