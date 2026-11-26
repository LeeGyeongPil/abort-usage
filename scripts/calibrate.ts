// Development script: compares the default estimator and chars/4 with the o200k_base tokenizer
// on test/fixtures/calibration.json.  Run: npm run calibrate        (error table)
//                                          npm run calibrate -- --fit  (also print fitted coefficients)
import { readFileSync } from 'node:fs';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { DEFAULT_COEFFICIENTS, charClassEstimator, countCharClasses } from '../src/estimators.ts';
import type { CharClassCoefficients } from '../src/types.ts';

interface Sample {
  category: string;
  text: string;
}

const corpus = JSON.parse(readFileSync(new URL('../test/fixtures/calibration.json', import.meta.url), 'utf8')) as {
  samples: Sample[];
};
const rows = corpus.samples.map((s) => ({
  category: s.category,
  chars: s.text.length,
  actual: encode(s.text).length,
  classes: countCharClasses(s.text),
  text: s.text,
}));

const KEYS = ['hangul', 'cjk', 'word', 'space', 'symbol'] as const;

/** Coordinate descent on relative squared error, coefficients kept positive. CJK has no samples: kept as is. */
function fit(): CharClassCoefficients {
  const c: CharClassCoefficients = { ...DEFAULT_COEFFICIENTS };
  const loss = (k: CharClassCoefficients): number =>
    rows.reduce((sum, r) => {
      const pred = KEYS.reduce((a, key) => a + r.classes[key] * k[key], 0);
      return sum + ((pred - r.actual) / r.actual) ** 2;
    }, 0);
  let step = 0.1;
  for (let iter = 0; iter < 400; iter++) {
    for (const key of ['hangul', 'word', 'space', 'symbol'] as const) {
      for (const delta of [step, -step]) {
        const trial = { ...c, [key]: Math.max(0.005, c[key] + delta) };
        if (loss(trial) < loss(c)) c[key] = trial[key];
      }
    }
    step = Math.max(0.0005, step * 0.98);
  }
  for (const key of KEYS) c[key] = Math.round(c[key] * 1000) / 1000;
  return c;
}

const estimator = charClassEstimator();
const categories = [...new Set(rows.map((r) => r.category))];

const pct = (est: number, actual: number): string => `${est >= actual ? '+' : ''}${(((est - actual) / actual) * 100).toFixed(1)}%`;

console.log('category  samples  o200k  char-class (err)   chars/4 (err)');
for (const category of categories) {
  const subset = rows.filter((r) => r.category === category);
  const actual = subset.reduce((a, r) => a + r.actual, 0);
  const mine = subset.reduce((a, r) => a + estimator.count(r.text), 0);
  const naive = subset.reduce((a, r) => a + Math.ceil(r.chars / 4), 0);
  console.log(
    `${category.padEnd(9)} ${String(subset.length).padStart(7)} ${String(actual).padStart(6)}  ` +
      `${String(mine).padStart(6)} (${pct(mine, actual).padStart(7)})   ${String(naive).padStart(6)} (${pct(naive, actual).padStart(7)})`,
  );
}

if (process.argv.includes('--fit')) {
  console.log('\nFitted coefficients (paste into DEFAULT_COEFFICIENTS):');
  console.log(JSON.stringify(fit()));
}
