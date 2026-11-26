import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runScenario, runStream } from './helpers/scenarios.ts';
import { textModel } from './helpers/mock-models.ts';

// AC-2: the user presses stop in the middle of one answer.
test('abort: the summary is already filled inside the SDK onAbort callback', async () => {
  const r = await runScenario('abort');
  // the SDK itself has nothing for the aborted call
  assert.deepEqual(r.sdk.callbacks, ['onAbort']);
  assert.deepEqual(r.sdk.abortStepUsages, []);

  const inside = r.summaryInOnAbort;
  assert.ok(inside, 'onAbort must have been called');
  assert.equal(inside.steps.length, 1);
  const step = inside.steps[0]!;
  assert.equal(step.outcome, 'abort');
  assert.ok(step.input.tokens > 0);
  assert.ok(step.output.tokens > 0);
  assert.equal(step.input.source, 'estimated');
  assert.equal(step.output.source, 'estimated');
  assert.equal(step.output.chars.text, r.receivedText.length);
  assert.ok(step.warnings.includes('upstream-may-continue'));
  assert.ok(step.warnings.includes('heuristic-estimate'));
  assert.equal(step.confidence, 'low');
  assert.match(step.error ?? '', /user pressed stop/);
  assert.equal(inside.complete, true);
  assert.equal(inside.reportedTokens, 0);
  assert.equal(inside.estimatedTokens, inside.totalTokens);
});

test('abort: a later cancel of the stream does not produce a second step', async () => {
  const r = await runScenario('abort');
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the stream cancel arrive
  assert.equal(r.onStepCalls, 1);
  assert.equal(r.tracker.steps.length, 1);
  assert.equal(r.tracker.summary().steps.length, 1);
});

test('abort: warnUpstreamMayContinue=false removes the warning', async () => {
  const r = await runStream({
    model: textModel({ delayMs: 10 }),
    abortAfterDeltas: 3,
    trackerOptions: { warnUpstreamMayContinue: false },
  });
  assert.ok(!r.summary.steps[0]!.warnings.includes('upstream-may-continue'));
});
