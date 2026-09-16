import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { channel } from "node:diagnostics_channel";
import { spawnSync } from "node:child_process";
import {
  callModel,
  defaults as baseDefaults,
  aiConfig,
  modelParams,
  ModelError,
  parseRetryAfter,
  validateEndpoint,
  validateEffectiveEndpoint,
  effectiveModelConfig,
} from "../packages/core/src/ai.js";
const defaults = {
  ...baseDefaults,
  ...baseDefaults.primary,
  provider: "nvidia" as const,
  baseUrl: "https://integrate.api.nvidia.com/v1",
  model: "deepseek-ai/deepseek-v4-flash-0731",
};
test("loading model transport does not replace the OCI SDK's HTTP dispatcher", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    const keys = ['undici.globalDispatcher.1', 'undici.globalDispatcher.2'].map(Symbol.for);
    const before = keys.map(key => globalThis[key]);
    await import('./packages/core/src/ai.ts');
    keys.forEach((key, index) => assert.equal(globalThis[key], before[index]));
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
test("model transport allows the full deadline and still aborts a silent server", async () => {
  const original = globalThis.fetch;
  const server = createServer((_request, response) => {
    response.end(
      JSON.stringify({ choices: [{ message: { content: '{"changes":[]}' } }] }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const requests: { headersTimeout: number; bodyTimeout: number }[] = [];
  const events = channel("undici:request:create");
  const observe = (event: unknown) =>
    requests.push((event as { request: (typeof requests)[number] }).request);
  events.subscribe(observe);
  globalThis.fetch = (_url, init) =>
    original(`http://127.0.0.1:${address.port}`, init);
  try {
    await callModel(defaults, "synthetic", [], AbortSignal.timeout(2000));
    assert.ok(requests[0].headersTimeout > 330_000);
    assert.ok(requests[0].bodyTimeout > 330_000);
    server.removeAllListeners("request");
    server.on("request", () => {});
    await assert.rejects(
      callModel(defaults, "synthetic", [], AbortSignal.timeout(50)),
      { name: "TimeoutError" },
    );
  } finally {
    globalThis.fetch = original;
    events.unsubscribe(observe);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
test("NVIDIA pending responses poll the same request without resubmitting inference", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  let reservations = 0;
  const observations: any[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return urls.length === 1
      ? new Response(
          JSON.stringify({ requestId: "12345678-1234-1234-1234-123456789abc" }),
          { status: 202 },
        )
      : new Response(
          JSON.stringify({
            choices: [
              { finish_reason: "stop", message: { content: '{"changes":[]}' } },
            ],
            usage: { total_tokens: 4 },
          }),
        );
  };
  try {
    const r = await callModel(
      defaults,
      "synthetic",
      [],
      AbortSignal.timeout(5000),
      async () => {
        reservations++;
      },
      (event) => observations.push(event),
    );
    assert.deepEqual(r.output, { changes: [] });
    assert.equal(urls.length, 2);
    assert.equal(reservations, 1);
    assert.deepEqual(
      observations.map((e) => e.type),
      ["response", "poll", "response", "usage", "completion"],
    );
    assert.deepEqual(
      observations.filter((e) => e.type === "response").map((e) => e.status),
      [202, 200],
    );
    assert.ok(urls[1].endsWith("/status/12345678-1234-1234-1234-123456789abc"));
  } finally {
    globalThis.fetch = original;
  }
});
test("provider rate limiting respects the provider retry delay and does not expose response bodies", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("synthetic-secret", {
      status: 429,
      headers: { "Retry-After": "99999" },
    });
  try {
    await assert.rejects(
      callModel(defaults, "synthetic", [], AbortSignal.timeout(1000)),
      (e: any) =>
        e instanceof ModelError &&
        e.code === "AI_HTTP_429" &&
        e.retryAfter === 99999 &&
        !e.message.includes("synthetic-secret"),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("HTTP failure without Retry-After does not invent a provider deadline", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 504 });
  try {
    await assert.rejects(
      callModel(defaults, "synthetic", [], AbortSignal.timeout(1000)),
      (error: unknown) =>
        error instanceof ModelError &&
        error.code === "AI_HTTP_504" &&
        error.retryable &&
        error.retryAfter === null,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("Retry-After accepts seconds and HTTP dates without shortening provider cooldowns", () => {
  const now = Date.UTC(2026, 8, 13);
  assert.equal(parseRetryAfter("120", now), 120);
  assert.equal(parseRetryAfter(new Date(now + 90000).toUTCString(), now), 90);
  assert.equal(parseRetryAfter(new Date(now - 90000).toUTCString(), now), 0);
  assert.equal(parseRetryAfter("invalid", now), null);
  assert.equal(parseRetryAfter(null, now), null);
  assert.equal(parseRetryAfter("0", now), 0);
});

test("invalid model JSON still reports HTTP success and consumed tokens without leaking output", async () => {
  const original = globalThis.fetch;
  const observations: any[] = [];
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "synthetic-private-output" },
          },
        ],
        usage: { total_tokens: 91 },
      }),
    );
  try {
    await assert.rejects(
      callModel(
        defaults,
        "synthetic",
        [],
        AbortSignal.timeout(1000),
        undefined,
        (event) => observations.push(event),
      ),
      (e: any) => e.code === "AI_INVALID_JSON",
    );
    assert.deepEqual(observations, [
      { type: "response", status: 200 },
      { type: "usage", usage: { total_tokens: 91 } },
      { type: "completion", finishReason: "stop", outputChars: 24 },
    ]);
    assert.ok(!JSON.stringify(observations).includes("private-output"));
  } finally {
    globalThis.fetch = original;
  }
});

test("daily limit is optional and explicit limits remain positive bounded integers", () => {
  assert.equal(defaults.dailyCalls, null);
  assert.equal(aiConfig.parse({ dailyCalls: null }).dailyCalls, null);
  assert.equal(aiConfig.parse({ dailyCalls: 24 }).dailyCalls, 24);
  for (const dailyCalls of [0, -1, 1.5, 1001, "unlimited"])
    assert.equal(aiConfig.safeParse({ dailyCalls }).success, false);
});

test("NVIDIA DeepSeek reasoning uses the documented chat template controls", async () => {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { content: '{"changes":[]}' } },
        ],
      }),
    );
  };
  try {
    for (const reasoning of ["none", "high", "max", "default"] as const)
      await callModel(
        { ...defaults, reasoning },
        "synthetic",
        [],
        AbortSignal.timeout(1000),
      );
    assert.deepEqual(bodies[0].chat_template_kwargs, { thinking: false });
    assert.deepEqual(bodies[1].chat_template_kwargs, {
      thinking: true,
      reasoning_effort: "high",
    });
    assert.deepEqual(bodies[2].chat_template_kwargs, {
      thinking: true,
      reasoning_effort: "max",
    });
    assert.equal(bodies[3].chat_template_kwargs, undefined);
    assert.ok(bodies.every((b) => b.reasoning_effort === undefined));
    await callModel(
      { ...defaults, provider: "openai-compatible", reasoning: "none" },
      "synthetic",
      [],
      AbortSignal.timeout(1000),
    );
    assert.equal(bodies[4].reasoning_effort, "none");
    assert.equal(bodies[4].chat_template_kwargs, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("pending inference can keep polling past 40 results within the caller deadline", async (t) => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return requests <= 41
      ? new Response(
          JSON.stringify({ requestId: "12345678-1234-1234-1234-123456789abc" }),
          { status: 202 },
        )
      : new Response(
          JSON.stringify({
            choices: [
              { finish_reason: "stop", message: { content: '{"changes":[]}' } },
            ],
          }),
        );
  };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const call = callModel(
      defaults,
      "synthetic",
      [],
      new AbortController().signal,
    );
    let outcome: any;
    void call.then(
      (value) => {
        outcome = { value };
      },
      (error) => {
        outcome = { error };
      },
    );
    for (let i = 0; i < 60 && !outcome; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      t.mock.timers.tick(2001);
    }
    const result = await call;
    assert.equal(requests, 42);
    assert.deepEqual(result.output, { changes: [] });
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = original;
  }
});

test("the caller can abort a pending inference without a new inference request", async () => {
  const original = globalThis.fetch,
    controller = new AbortController();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    controller.abort();
    return new Response(
      JSON.stringify({ requestId: "12345678-1234-1234-1234-123456789abc" }),
      { status: 202 },
    );
  };
  try {
    await assert.rejects(
      callModel(defaults, "synthetic", [], controller.signal),
      { name: "AbortError" },
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("Alibaba Qwen disables thinking using its native option and rejects unsupported effort", async () => {
  const original = globalThis.fetch;
  const oldHosts = process.env.AI_ALLOWED_HOSTS;
  const bodies: any[] = [];
  process.env.AI_ALLOWED_HOSTS = "dashscope-intl.aliyuncs.com";
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"changes":[]}' } }] }),
    );
  };
  const config = {
    ...defaults,
    provider: "openai-compatible" as const,
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-flash-2026-07-15",
  };
  try {
    await callModel(config, "synthetic", [], AbortSignal.timeout(1000));
    assert.equal(bodies[0].enable_thinking, false);
    assert.deepEqual(bodies[0].response_format, { type: "json_object" });
    assert.equal(bodies[0].reasoning_effort, undefined);
    await callModel(
      { ...config, reasoning: "default" },
      "synthetic",
      [],
      AbortSignal.timeout(1000),
    );
    assert.equal(bodies[1].enable_thinking, undefined);
    await assert.rejects(
      callModel(
        { ...config, reasoning: "high" },
        "synthetic",
        [],
        AbortSignal.timeout(1000),
      ),
      /AI_REASONING_NOT_SUPPORTED/,
    );
    assert.equal(bodies.length, 2);
    await callModel(
      { ...config, model: "other-model" },
      "synthetic",
      [],
      AbortSignal.timeout(1000),
    );
    assert.equal(bodies[2].reasoning_effort, "none");
    assert.equal(bodies[2].enable_thinking, undefined);
    assert.equal(bodies[2].response_format, undefined);
  } finally {
    globalThis.fetch = original;
    if (oldHosts === undefined) delete process.env.AI_ALLOWED_HOSTS;
    else process.env.AI_ALLOWED_HOSTS = oldHosts;
  }
});

test("Alibaba DeepSeek V4 accepts saved BYOK controls and sends native JSON requests", async () => {
  const original = globalThis.fetch;
  const oldHosts = process.env.AI_ALLOWED_HOSTS;
  process.env.AI_ALLOWED_HOSTS = "dashscope-intl.aliyuncs.com";
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"message":"Hello"}' } }],
      }),
    );
  };
  const config = effectiveModelConfig(
    aiConfig.parse({
      ...baseDefaults,
      provider: "openai-compatible",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      primary: {
        model: "deepseek-v4-flash",
        enable_thinking: false,
        thinking_budget: 1024,
        max_completion_tokens: 16384,
      },
      enabled: false,
    }),
    false,
  );
  try {
    for (const model of [
      "deepseek-v4-flash",
      "deepseek-v4-flash-0731",
      "deepseek-v4-pro",
      "deepseek-v4-pro-0813",
      "deepseek-v4.1-flash",
      "deepseek-v4.1-pro-0901",
    ]) {
      await callModel(
        { ...config, model },
        "synthetic",
        [],
        AbortSignal.timeout(1000),
      );
      const body = bodies.at(-1)!;
      assert.equal(body.model, model);
      assert.equal(body.enable_thinking, false);
      assert.equal(body.max_completion_tokens, 16384);
      assert.equal(body.max_tokens, undefined);
      assert.equal(body.thinking_budget, undefined);
      assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.chat_template_kwargs, undefined);
      assert.deepEqual(body.response_format, { type: "json_object" });
      await callModel(
        { ...config, model, max_completion_tokens: null },
        "synthetic",
        [],
        AbortSignal.timeout(1000),
      );
      assert.equal(
        Object.hasOwn(bodies.at(-1)!, "max_completion_tokens"),
        false,
      );
      assert.equal(Object.hasOwn(bodies.at(-1)!, "max_tokens"), false);
    }
    await callModel(
      { ...config, enable_thinking: true },
      "synthetic",
      [],
      AbortSignal.timeout(1000),
    );
    assert.equal(bodies.at(-1)!.thinking_budget, 1024);
    assert.equal(bodies.at(-1)!.enable_thinking, true);
    for (const reasoning of ["high", "max"] as const) {
      await callModel(
        { ...config, enable_thinking: true, thinking_budget: null, reasoning },
        "synthetic",
        [],
        AbortSignal.timeout(1000),
      );
      assert.equal(bodies.at(-1)!.reasoning_effort, reasoning);
      assert.equal(bodies.at(-1)!.thinking_budget, undefined);
    }
    await callModel(
      { ...config, enable_thinking: false, reasoning: "high" },
      "synthetic",
      [],
      AbortSignal.timeout(1000),
    );
    assert.equal(
      bodies.at(-1)!.reasoning_effort,
      undefined,
      "explicit OFF overrides effort",
    );
    await assert.rejects(
      callModel(
        { ...config, model: "unrecognized-model" },
        "synthetic",
        [],
        AbortSignal.timeout(1000),
      ),
      /AI_REASONING_NOT_SUPPORTED/,
    );
    // The widened deepseek-v4(.N)? regex must not accept a different major
    // version or a missing dot separator.
    for (const model of ["deepseek-v41-flash", "deepseek-v5-flash"])
      await assert.rejects(
        callModel({ ...config, model }, "synthetic", [], AbortSignal.timeout(1000)),
        /AI_REASONING_NOT_SUPPORTED/,
      );
    await assert.rejects(
      callModel(
        {
          ...config,
          provider: "nvidia",
          model: defaults.model,
          baseUrl: defaults.baseUrl,
        },
        "synthetic",
        [],
        AbortSignal.timeout(1000),
      ),
      /AI_REASONING_NOT_SUPPORTED/,
    );
    assert.equal(bodies.length, 16);
  } finally {
    globalThis.fetch = original;
    if (oldHosts === undefined) delete process.env.AI_ALLOWED_HOSTS;
    else process.env.AI_ALLOWED_HOSTS = oldHosts;
  }
});

test("Qwen forwards explicit thinking budget and total completion cap, preserving usage details", async () => {
  const original = globalThis.fetch,
    allowed = process.env.AI_ALLOWED_HOSTS;
  process.env.AI_ALLOWED_HOSTS = "dashscope-intl.aliyuncs.com";
  const bodies: any[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: '{"changes":[]}',
              reasoning_content: "synthetic thinking, never persisted",
            },
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 80,
          total_tokens: 200,
          prompt_tokens_details: { cached_tokens: 64 },
          completion_tokens_details: { reasoning_tokens: 50 },
        },
      }),
    );
  };
  const config = effectiveModelConfig(
    aiConfig.parse({
      ...baseDefaults,
      provider: "openai-compatible",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      primary: {
        model: "qwen3.7-flash",
        enable_thinking: true,
        thinking_budget: 1024,
        max_completion_tokens: 4096,
      },
    }),
    false,
  );
  try {
    const r = await callModel(
      config,
      "synthetic",
      [],
      AbortSignal.timeout(1000),
    );
    assert.equal(bodies[0].enable_thinking, true);
    assert.equal(bodies[0].thinking_budget, 1024);
    assert.equal(bodies[0].max_completion_tokens, 4096);
    assert.equal(bodies[0].max_tokens, undefined);
    assert.equal(bodies[0].reasoning_effort, undefined);
    assert.equal(r.usage.completion_tokens_details?.reasoning_tokens, 50);
    assert.equal(r.usage.prompt_tokens_details?.cached_tokens, 64);
    assert.equal(JSON.stringify(r).includes("synthetic thinking"), false);
    await callModel(
      { ...config, enable_thinking: false },
      "synthetic",
      [],
      AbortSignal.timeout(1000),
    );
    assert.equal(bodies[1].thinking_budget, undefined);
    assert.equal(bodies[1].enable_thinking, false);
    await callModel(
      { ...config, max_completion_tokens: null, thinking_budget: null },
      "synthetic",
      [],
      AbortSignal.timeout(1000),
    );
    assert.equal(Object.hasOwn(bodies[2], "max_completion_tokens"), false);
    assert.equal(Object.hasOwn(bodies[2], "max_tokens"), false);
    assert.equal(Object.hasOwn(bodies[2], "thinking_budget"), false);
    await assert.rejects(
      callModel(
        {
          ...config,
          provider: "nvidia",
          baseUrl: defaults.baseUrl,
          model: defaults.model,
        },
        "synthetic",
        [],
        AbortSignal.timeout(1000),
      ),
    );
    assert.equal(bodies.length, 3);
  } finally {
    globalThis.fetch = original;
    if (allowed === undefined) delete process.env.AI_ALLOWED_HOSTS;
    else process.env.AI_ALLOWED_HOSTS = allowed;
  }
});

test("failed JSON still reports usage and finish reason for later diagnosis", async () => {
  const original = globalThis.fetch;
  const events: any[] = [];
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          { finish_reason: "length", message: { content: '{"changes":' } },
        ],
        usage: {
          prompt_tokens: 25,
          completion_tokens: 512,
          total_tokens: 537,
          completion_tokens_details: { reasoning_tokens: 400 },
        },
      }),
    );
  try {
    await assert.rejects(
      callModel(
        defaults,
        "synthetic",
        [],
        AbortSignal.timeout(1000),
        undefined,
        (e) => events.push(e),
      ),
      { code: "AI_OUTPUT_LIMIT" },
    );
    assert.equal(
      events.find((e) => e.type === "usage").usage.completion_tokens_details
        .reasoning_tokens,
      400,
    );
    assert.equal(
      events.find((e) => e.type === "completion").finishReason,
      "length",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("the effective fallback config passes endpoint validation as a single model", () => {
  const config = aiConfig.parse({
    ...baseDefaults,
    provider: "openai-compatible",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    primary: { model: "deepseek-v4-flash" },
    fallback: { model: "deepseek-v4-flash-0731" },
  });
  validateEndpoint(config);
  const effective = effectiveModelConfig(config, true);
  assert.equal(effective.model, "deepseek-v4-flash-0731");
  validateEffectiveEndpoint(effective);
  assert.equal(effectiveModelConfig(config, false).model, "deepseek-v4-flash");
  assert.throws(
    () =>
      validateEndpoint({
        ...config,
        fallback: modelParams.parse({ model: config.primary.model }),
      }),
    (e: any) => e.code === "AI_FALLBACK_SAME_MODEL",
  );
  // A newer minor-version sibling (deepseek-v4.1-flash) is a recognized
  // fallback and validates cleanly, including through effectiveModelConfig.
  const widened = {
    ...config,
    fallback: modelParams.parse({ model: "deepseek-v4.1-flash" }),
  };
  validateEndpoint(widened);
  validateEffectiveEndpoint(effectiveModelConfig(widened, true));
  // When the fallback is a model our regex does not recognize at all, its own
  // reasoning fields fail validation for it specifically, and that must be
  // attributed to the fallback, not read as if primary were rejected.
  assert.throws(
    () =>
      validateEndpoint({
        ...config,
        fallback: modelParams.parse({
          model: "unrecognized-model",
          enable_thinking: true,
        }),
      }),
    (e: any) => e.code === "AI_FALLBACK_REASONING_NOT_SUPPORTED",
  );
});

// enable_thinking could be turned on but never off: a JSON patch cannot send
// undefined and an omitted key keeps the stored value, so a workspace pinned to
// a thinking model could not move to one without reasoning support — which is
// exactly what a quota running out forces you to do. null now clears it.
test("enable_thinking can be cleared with null so a non-thinking model is accepted", () => {
  process.env.AI_ALLOWED_HOSTS = "dashscope-intl.aliyuncs.com";
  const base = {
    ...baseDefaults,
    provider: "openai-compatible" as const,
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  };
  const stillSet = modelParams.parse({
    model: "glm-5.2",
    reasoning: "default",
    enable_thinking: true,
  });
  assert.throws(
    () => validateEffectiveEndpoint({ ...base, ...stillSet }),
    /AI_REASONING_NOT_SUPPORTED/,
    "leaving enable_thinking set rejects a model that cannot use it",
  );
  const cleared = modelParams.parse({
    model: "glm-5.2",
    reasoning: "default",
    enable_thinking: null,
  });
  assert.equal(cleared.enable_thinking, null);
  assert.doesNotThrow(
    () => validateEffectiveEndpoint({ ...base, ...cleared }),
    "clearing enable_thinking lets a model without reasoning support validate",
  );
});
