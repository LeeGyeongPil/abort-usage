import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runScenario } from './helpers/scenarios.ts';

// AC-3: the provider connection breaks with an error chunk.
test('provider error: the SDK has no usage, abort-usage has numbers', async () => {
  const r = await runScenario('provider-error');
  assert.ok(r.sdk.callbacks.includes('onError'));
  assert.ok(r.sdk.callbacks.includes('onFinish'));
  assert.equal(r.sdk.finishTotalUsage?.inputTokens, undefined);

  assert.equal(r.summary.steps.length, 1);
  const step = r.summary.steps[0]!;
  assert.equal(step.outcome, 'error');
  assert.match(step.error ?? '', /upstream connection reset/);
  assert.ok(step.input.tokens > 0);
  assert.ok(step.output.tokens > 0);
  assert.equal(step.input.source, 'estimated');
  assert.equal(step.output.source, 'estimated');
  assert.equal(step.output.chars.text, r.receivedText.length);
  assert.equal(r.onStepCalls, 1);
});
