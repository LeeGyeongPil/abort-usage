import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textModel } from './helpers/mock-models.ts';
import { runScenario, runStream } from './helpers/scenarios.ts';

// AC-4: an agent finished its tool step, then the user stopped during the second step.
test('multi-step abort: reported first step plus estimated second step', async () => {
  const r = await runScenario('multistep-abort');
  // the SDK only knows about the first step
  assert.deepEqual(r.sdk.abortStepUsages, [{ inputTokens: 30, outputTokens: 12 }]);

  const summary = r.summaryInOnAbort;
  assert.ok(summary);
  assert.equal(summary.steps.length, 2);
  const [one, two] = summary.steps as [(typeof summary.steps)[number], (typeof summary.steps)[number]];
  assert.equal(one.outcome, 'finish');
  assert.equal(one.input.tokens, 30);
  assert.equal(one.output.tokens, 12);
  assert.equal(one.input.source, 'reported');
  assert.equal(two.outcome, 'abort');
  assert.equal(two.input.source, 'estimated');
  assert.equal(two.output.source, 'estimated');

  assert.equal(summary.inputTokens, 30 + two.input.tokens);
  assert.equal(summary.outputTokens, 12 + two.output.tokens);
  assert.equal(summary.reportedTokens, 42);
  assert.equal(summary.estimatedTokens, two.input.tokens + two.output.tokens);
  assert.equal(summary.confidence, 'low');
  assert.equal(r.onStepCalls, 2);
});

test('multi-step abort: the second prompt includes the tool result so its estimate is larger', async () => {
  // estimate of the first prompt: same prompt and tools, aborted in step 1 so nothing is reported
  const first = await runStream({ model: textModel({ delayMs: 10 }), maxSteps: 3, abortAfterDeltas: 1 });
  const firstEstimate = first.summary.steps[0]!.input.tokens;
  const r = await runScenario('multistep-abort');
  const two = r.summary.steps[1]!;
  assert.ok(two.input.tokens > firstEstimate, `${two.input.tokens} should exceed ${firstEstimate}`);
});
