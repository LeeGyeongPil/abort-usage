import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { charClassEstimator, tokenizerEstimator } from '../src/index.ts';
import { runStream } from './helpers/scenarios.ts';
import { noUsageModel } from './helpers/mock-models.ts';

interface Sample {
  category: string;
  text: string;
}
const samples = (
  JSON.parse(readFileSync(new URL('./fixtures/calibration.json', import.meta.url), 'utf8')) as { samples: Sample[] }
).samples;

function totals(category: string) {
  const subset = samples.filter((s) => s.category === category);
  const est = charClassEstimator();
  return {
    n: subset.length,
    actual: subset.reduce((a, s) => a + encode(s.text).length, 0),
    mine: subset.reduce((a, s) => a + est.count(s.text), 0),
    naive: subset.reduce((a, s) => a + Math.ceil(s.text.length / 4), 0),
  };
}

// AC-6: accuracy of the default estimator
for (const category of ['en', 'ko', 'code', 'json']) {
  test(`char-class estimator is within 25% of o200k for ${category}`, () => {
    const t = totals(category);
    assert.ok(t.n >= 4, 'corpus needs at least 4 samples per category');
    const error = (t.mine - t.actual) / t.actual;
    assert.ok(Math.abs(error) <= 0.25, `${category}: ${(error * 100).toFixed(1)}%`);
  });
}

test('chars/4 is off by more than 25% on English or Korean (why the heuristic exists)', () => {
  const off = ['en', 'ko'].some((c) => {
    const t = totals(c);
    return Math.abs((t.naive - t.actual) / t.actual) > 0.25;
  });
  assert.ok(off);
});

test('tokenizerEstimator uses the injected function and labels the numbers high confidence', async () => {
  const estimator = tokenizerEstimator((text) => encode(text).length, 'o200k');
  assert.equal(estimator.count('hello world'), encode('hello world').length);
  assert.equal(estimator.count(''), 0);
  const r = await runStream({ model: noUsageModel(), trackerOptions: { estimator } });
  const step = r.summary.steps[0]!;
  assert.equal(step.output.method, 'tokenizer:o200k');
  assert.equal(step.input.method, 'tokenizer:o200k');
  assert.equal(step.confidence, 'high');
  assert.ok(!step.warnings.includes('heuristic-estimate'));
});

test('invalid arguments raise TypeError and RangeError with a fix hint', () => {
  assert.throws(() => tokenizerEstimator('nope' as never), TypeError);
  assert.throws(() => tokenizerEstimator('nope' as never), /must be a function/);
  assert.throws(() => charClassEstimator({ word: 0 }), RangeError);
  assert.throws(() => charClassEstimator({ hangul: -1 }), RangeError);
  assert.throws(() => charClassEstimator({ symbol: Number.NaN }), /greater than 0/);
});

test('estimates are never zero for non-empty text and zero for empty text', () => {
  const est = charClassEstimator();
  assert.equal(est.count(''), 0);
  assert.equal(est.count('a'), 1);
});
