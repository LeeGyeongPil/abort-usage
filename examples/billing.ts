// Share one wrapped model between requests and bill every step as it ends. Mock provider, no API key.
// Run: node examples/billing.ts
import { streamText, simulateReadableStream, wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { usageMiddleware, toLanguageModelUsage, summarize, type StepUsage } from 'abort-usage';

const provider = new MockLanguageModelV4({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 5,
      chunks: [
        { type: 'text-start', id: 't1' },
        ...Array.from({ length: 20 }, (_, i) => ({ type: 'text-delta', id: 't1', delta: `word${i} ` })),
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 42 }, outputTokens: { total: 20 } } },
      ],
    }) as never,
  }),
}) as never;

const ledger: StepUsage[] = [];
const model = wrapLanguageModel({
  model: provider,
  middleware: usageMiddleware({
    onStep: (step) => { ledger.push(step); },   // called once per model call, even after abort or error
  }),
});

const controller = new AbortController();
const result = streamText({ model, prompt: 'Count slowly.', abortSignal: controller.signal });
let seen = 0;
for await (const part of result.fullStream) {
  if (part.type === 'text-delta' && ++seen === 3) controller.abort();
}

console.log(ledger.map((s) => `${s.outcome}: ${s.input.tokens} in (${s.input.source}) / ${s.output.tokens} out (${s.output.source})`));
console.log(toLanguageModelUsage(summarize(ledger)));
