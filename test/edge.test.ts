import assert from 'node:assert/strict';
import { test } from 'node:test';
import { streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createUsageTracker, usageMiddleware, type StepUsage } from '../src/index.ts';
import { noUsageModel, textModel, WORDS } from './helpers/mock-models.ts';
import { runStream } from './helpers/scenarios.ts';

// AC-5 (a): the finish chunk has no usage numbers.
test('finish without usage numbers: those numbers are estimated and flagged', async () => {
  const r = await runStream({ model: noUsageModel() });
  const step = r.summary.steps[0]!;
  assert.equal(step.outcome, 'finish');
  assert.equal(step.input.source, 'estimated');
  assert.equal(step.output.source, 'estimated');
  assert.ok(step.input.tokens > 0 && step.output.tokens > 0);
  assert.ok(step.warnings.includes('reported-usage-missing'));
  assert.equal(step.output.chars.text, WORDS.join('').length);
});

test('finish with only the input number: only the output is estimated', async () => {
  const model = textModel({
    finishUsage: {
      inputTokens: { total: 42, noCache: 42, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    },
  });
  const r = await runStream({ model });
  const step = r.summary.steps[0]!;
  assert.equal(step.input.source, 'reported');
  assert.equal(step.input.tokens, 42);
  assert.equal(step.output.source, 'estimated');
  assert.ok(step.warnings.includes('reported-usage-missing'));
  assert.equal(r.summary.reportedTokens, 42);
});

// AC-5 (b): the consumer stops reading without an AbortSignal.
test('consumer cancel without abortSignal: closed as cancel or visible as open, never zero', async () => {
  const r = await runStream({ model: textModel({ delayMs: 10 }), cancelAfterDeltas: 3 });
  assert.equal(r.summary.steps.length, 1);
  const step = r.summary.steps[0]!;
  assert.ok(step.outcome === 'cancel' || step.outcome === 'open', `unexpected outcome ${step.outcome}`);
  assert.ok(step.input.tokens > 0);
  assert.ok(step.output.tokens > 0);
  assert.equal(step.input.source, 'estimated');
  if (step.outcome === 'open') assert.equal(r.summary.complete, false);
  else assert.equal(r.summary.complete, true);
});

// AC-5 (c): a failing callback must not break the stream.
test('onStep that throws: the text still arrives and onCallbackError is called once', async () => {
  const errors: unknown[] = [];
  const r = await runStream({
    model: textModel(),
    trackerOptions: {
      onStep: () => {
        throw new Error('ledger down');
      },
      onCallbackError: (e) => errors.push(e),
    },
  });
  assert.equal(r.receivedText, WORDS.join(''));
  assert.equal(errors.length, 1);
  assert.match(String((errors[0] as Error).message), /ledger down/);
  assert.equal(r.summary.steps.length, 1);
});

test('onStep that rejects asynchronously is routed to onCallbackError too', async () => {
  const errors: unknown[] = [];
  await runStream({
    model: textModel(),
    trackerOptions: {
      onStep: async () => {
        throw new Error('async ledger down');
      },
      onCallbackError: (e) => errors.push(e),
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(errors.length, 1);
});

// AC-5 (d): images are not counted and the summary says so.
test('image parts in the prompt add the non-text-input-not-counted warning', async () => {
  const tracker = createUsageTracker();
  const result = streamText({
    model: tracker.wrap(noUsageModel()),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this picture?' },
          { type: 'file', data: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png' },
        ],
      },
    ],
  });
  await result.consumeStream();
  const step = tracker.summary().steps[0]!;
  assert.ok(step.warnings.includes('non-text-input-not-counted'));
  assert.equal(step.input.source, 'estimated');
});

test('doStream that throws closes the step as error and rethrows', async () => {
  const steps: StepUsage[] = [];
  const model = new MockLanguageModelV4({
    doStream: async () => {
      throw new Error('401 unauthorized');
    },
  });
  const tracker = createUsageTracker({ onStep: (s) => void steps.push(s) });
  const result = streamText({ model: tracker.wrap(model as never), prompt: 'hello there', maxRetries: 0, onError: () => {} });
  await result.consumeStream();
  assert.equal(steps.length, 1);
  assert.equal(steps[0]!.outcome, 'error');
  assert.match(steps[0]!.error ?? '', /401/);
  assert.ok(steps[0]!.input.tokens > 0);
});

test('an abort signal that is already aborted still yields one estimated step', async () => {
  const steps: StepUsage[] = [];
  const controller = new AbortController();
  controller.abort(new Error('too late'));
  const wrapped = usageMiddleware({ onStep: (s) => void steps.push(s) });
  const doStream = async () => ({ stream: new ReadableStream() }) as never;
  await (wrapped.wrapStream as NonNullable<typeof wrapped.wrapStream>)({
    doStream,
    doGenerate: async () => ({}) as never,
    model: {} as never,
    params: { prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], abortSignal: controller.signal } as never,
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0]!.outcome, 'abort');
});

test('usageMiddleware rejects a missing onStep with a fix hint', () => {
  assert.throws(() => usageMiddleware({} as never), /onStep must be a function/);
});

test('an injected tokenizer that throws falls back to the heuristic instead of breaking the stream', async () => {
  const { tokenizerEstimator } = await import('../src/index.ts');
  const r = await runStream({
    model: noUsageModel(),
    trackerOptions: {
      estimator: tokenizerEstimator(() => {
        throw new Error('tokenizer crashed');
      }, 'broken'),
    },
  });
  const step = r.summary.steps[0]!;
  assert.ok(step.output.tokens > 0);
  assert.equal(step.output.method, 'char-class');
});
