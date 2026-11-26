// Quick start: count tokens of a stream that the user stops half way. Mock provider, no API key.
// Run: node examples/quickstart.ts
import { streamText, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createUsageTracker } from 'abort-usage';

const words = Array.from({ length: 20 }, (_, i) => `word${i} `);
const provider = new MockLanguageModelV4({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 5,
      chunks: [
        { type: 'text-start', id: 't1' },
        ...words.map((delta) => ({ type: 'text-delta', id: 't1', delta })),
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {
          inputTokens: { total: 42 }, outputTokens: { total: 20 } } },
      ],
    }) as never,
  }),
}) as never;

const tracker = createUsageTracker();                 // one tracker per request
const model = tracker.wrap(provider);                 // or: wrapLanguageModel({ model, middleware: tracker.middleware })
const controller = new AbortController();

// Read the total once per request: onFinish covers complete and provider-error ends,
// onAbort covers a stop. (After an error the SDK calls onError and then onFinish, so do not record in onError.)
const record = (where: string) => console.log(`${where} records:`, tracker.summary().totalTokens, 'tokens');

const result = streamText({
  model,
  prompt: 'Count slowly.',
  abortSignal: controller.signal,
  onFinish: () => record('onFinish'),
  onAbort: () => record('onAbort'),
});

let seen = 0;
for await (const part of result.fullStream) {
  if (part.type === 'text-delta' && ++seen === 5) controller.abort(); // the user presses "Stop"
}

const { inputTokens, outputTokens, reportedTokens, estimatedTokens, steps } = tracker.summary();
console.log({ inputTokens, outputTokens, reportedTokens, estimatedTokens });
const step = steps[0]!;
console.log(step.outcome, step.input.source, step.confidence, step.warnings);
