import type { Chunk } from "./chunking.js";
import { ModelError } from "./ai.js";

// Measure the complete request at the same seam used by the Worker.
export function fitModelChunk<T>(
  chunks: Chunk[],
  index: number,
  build: (chunk: Chunk) => T,
  measure: (input: T) => number,
  limit: number,
) {
  const original = chunks[index];
  if (!original) throw new ModelError("AI_CHUNK_MISSING");
  let chunk = { ...original },
    input = build(chunk),
    estimatedTokens = measure(input);
  if (estimatedTokens > limit) {
    // Only accepted, measured prefixes become runnable. Search near the limit
    // instead of halving every oversized input and wasting half the budget.
    let low = original.start,
      high = original.end - 1;
    let best: { chunk: Chunk; input: T; estimatedTokens: number } | undefined;
    while (low <= high) {
      const end = Math.floor((low + high) / 2),
        candidate = { ...original, end };
      const candidateInput = build(candidate),
        size = measure(candidateInput);
      if (size <= limit) {
        best = {
          chunk: candidate,
          input: candidateInput,
          estimatedTokens: size,
        };
        low = end + 1;
      } else high = end - 1;
    }
    if (!best) throw new ModelError("AI_INPUT_LIMIT");
    ({ chunk, input, estimatedTokens } = best);
  }
  const split = chunk.end !== original.end;
  const next = split
    ? [
        ...chunks.slice(0, index),
        chunk,
        {
          ...original,
          start: chunk.end + 1,
          contextStart: chunk.start,
          contextEnd: Math.min(chunk.end, chunk.start + 2),
        },
        ...chunks.slice(index + 1),
      ]
    : chunks;
  return { chunk, input, estimatedTokens, chunks: next, split };
}
