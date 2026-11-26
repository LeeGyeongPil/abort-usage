// Mock provider models (practice mode): only the provider's response is fake.
// streamText, wrapLanguageModel, AbortController and the SDK callbacks used with them are the real ones.
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

export function usage(input?: number, output?: number) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

export const WORDS = Array.from({ length: 20 }, (_, i) => `word${i} `);

type Chunk = Record<string, unknown>;

export function textChunks(words: readonly string[], finishUsage: ReturnType<typeof usage>): Chunk[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    ...words.map((w) => ({ type: 'text-delta', id: 't1', delta: w })),
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: finishUsage },
  ];
}

function streamOf(chunks: Chunk[], delayMs: number) {
  // chunkDelayInMs gives the abort a chance to land mid-stream, like a real network
  return simulateReadableStream({ chunks, chunkDelayInMs: delayMs }) as never;
}

/** One text answer of 20 words, finishing with provider usage 42 in / 20 out. */
export function textModel(opts: { finishUsage?: ReturnType<typeof usage>; delayMs?: number } = {}) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: streamOf(textChunks(WORDS, opts.finishUsage ?? usage(42, 20)), opts.delayMs ?? 5),
    }),
  }) as never;
}

/** Streams `afterWords` words and then an error chunk (connection reset). */
export function errorModel(afterWords = 5, delayMs = 5) {
  return new MockLanguageModelV4({
    doStream: async () => {
      const chunks = textChunks(WORDS, usage(42, 20)).slice(0, 2 + afterWords);
      chunks.push({ type: 'error', error: new Error('upstream connection reset') });
      return { stream: streamOf(chunks, delayMs) };
    },
  }) as never;
}

/** Step 1: a tool call that finishes with usage 30/12. Step 2: a long text answer. */
export function toolThenTextModel(delayMs = 5) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      call++;
      if (call === 1) {
        return {
          stream: streamOf(
            [
              { type: 'stream-start', warnings: [] },
              { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: '{"q":"tokens"}' },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: usage(30, 12) },
            ],
            delayMs,
          ),
        };
      }
      return { stream: streamOf(textChunks(WORDS, usage(80, 20)), delayMs) };
    },
  }) as never;
}

/** Streams the words but its finish chunk carries no usage numbers at all. */
export function noUsageModel(delayMs = 2) {
  return textModel({ finishUsage: usage(undefined, undefined), delayMs });
}
