import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toLanguageModelUsage } from '../src/index.ts';
import { runScenario } from './helpers/scenarios.ts';

// AC-1: a normal finish is reported by the provider and matches what the SDK sees.
test('complete stream: one reported step equal to the SDK totalUsage', async () => {
  const r = await runScenario('complete');
  // 정상 완료는 onFinish 한 번만 (README 의 Billing 표와 같아야 한다)
  assert.deepEqual(r.sdk.callbacks, ['onFinish']);
  assert.equal(r.summary.steps.length, 1);
  const step = r.summary.steps[0]!;
  assert.equal(step.outcome, 'finish');
  assert.equal(step.finishReason, 'stop');
  assert.equal(step.input.tokens, 42);
  assert.equal(step.output.tokens, 20);
  assert.equal(step.input.source, 'reported');
  assert.equal(step.output.source, 'reported');
  assert.equal(step.confidence, 'exact');
  assert.deepEqual(step.warnings, []);
  assert.equal(r.summary.complete, true);
  assert.equal(r.summary.reportedTokens, 62);
  assert.equal(r.summary.estimatedTokens, 0);

  const usage = toLanguageModelUsage(r.summary);
  assert.equal(usage.inputTokens, r.sdk.finishTotalUsage?.inputTokens);
  assert.equal(usage.outputTokens, r.sdk.finishTotalUsage?.outputTokens);
  assert.equal(usage.totalTokens, r.sdk.finishTotalUsage?.totalTokens);
  assert.equal(r.onStepCalls, 1);
});
