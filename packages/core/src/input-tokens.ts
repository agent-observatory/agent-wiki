import { isAlibabaQwen, type AiConfig } from "./ai.js";
import { estimateTokens } from "./chunking.js";

// QwenCloud recommends o200k_base for estimates. This is not the hosted
// model's billing tokenizer: reserve 10% and retain actual prompt_tokens.
let qwenCounter: Promise<(text: string) => number> | undefined;
export async function inputTokenCounter(config: AiConfig) {
  if (!isAlibabaQwen(config))
    return { version: "utf8-upper-bound-1", count: estimateTokens };
  qwenCounter ??= Promise.all([
    import("js-tiktoken/lite"),
    import("js-tiktoken/ranks/o200k_base"),
  ]).then(([{ Tiktoken }, { default: ranks }]) => {
    const encoder = new Tiktoken(ranks);
    // Session content can contain special-token spellings: treat them as text.
    return (text: string) =>
      Math.ceil(encoder.encode(text, [], []).length * 1.1);
  });
  return {
    version: "qwen-o200k-estimate-margin10-1",
    count: await qwenCounter,
  };
}
