// Inject a real tokenizer (gpt-tokenizer, o200k_base) so estimates are labelled confidence "high".
// Run: node examples/with-gpt-tokenizer.ts   (uses a mock model, no API key)
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { tokenizerEstimator } from '../src/index.ts';
import { runStream } from '../test/helpers/scenarios.ts';
import { textModel } from '../test/helpers/mock-models.ts';

const estimator = tokenizerEstimator((text) => encode(text).length, 'o200k');
const { summary } = await runStream({
  model: textModel({ delayMs: 10 }),
  abortAfterDeltas: 4,
  trackerOptions: { estimator },
});
console.log(JSON.stringify(summary, null, 2));
