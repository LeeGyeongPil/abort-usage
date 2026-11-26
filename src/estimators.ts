import type { CharClassCoefficients, TokenEstimator } from './types.ts';

/**
 * Default coefficients (tokens per character), fitted on test/fixtures/calibration.json
 * against the o200k_base tokenizer with `npm run calibrate`. They are an approximation:
 * other providers' tokenizers differ.
 */
export const DEFAULT_COEFFICIENTS: Readonly<CharClassCoefficients> = {
  hangul: 0.575,
  cjk: 0.9,
  word: 0.109,
  space: 0.584,
  symbol: 0.603,
};

export type CharClass = keyof CharClassCoefficients;

/** Counts characters per class. Exported for the calibration script. */
export function countCharClasses(text: string): Record<CharClass, number> {
  const counts: Record<CharClass, number> = { hangul: 0, cjk: 0, word: 0, space: 0, symbol: 0 };
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (
      (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
      (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
      (cp >= 0x3130 && cp <= 0x318f) // Hangul compatibility Jamo
    ) {
      counts.hangul++;
    } else if (
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK ideographs
      (cp >= 0x3040 && cp <= 0x30ff) || // kana
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x20000 && cp <= 0x2fa1f)
    ) {
      counts.cjk++;
    } else if (/\s/u.test(ch)) {
      counts.space++;
    } else if (/[\p{L}\p{N}_]/u.test(ch)) {
      counts.word++;
    } else {
      counts.symbol++;
    }
  }
  return counts;
}

/**
 * Dependency-free heuristic estimator: weighs Hangul, CJK, letters/digits, whitespace and
 * symbols differently. Much closer than `chars / 4` for Korean, code and JSON.
 *
 * @throws RangeError if a coefficient is not a finite number greater than 0.
 */
export function charClassEstimator(coefficients: Partial<CharClassCoefficients> = {}): TokenEstimator {
  const merged: CharClassCoefficients = { ...DEFAULT_COEFFICIENTS, ...coefficients };
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(
        `charClassEstimator: coefficient "${key}" must be a finite number greater than 0, got ${String(value)}.`,
      );
    }
  }
  return {
    name: 'char-class',
    confidence: 'low',
    count(text: string): number {
      if (text.length === 0) return 0;
      const c = countCharClasses(text);
      const raw =
        c.hangul * merged.hangul +
        c.cjk * merged.cjk +
        c.word * merged.word +
        c.space * merged.space +
        c.symbol * merged.symbol;
      return Math.max(1, Math.round(raw));
    },
  };
}

/**
 * Wraps a real tokenizer (for example `(t) => encode(t).length` from gpt-tokenizer).
 * Numbers from it are labelled `confidence: 'high'`.
 *
 * @throws TypeError if `count` is not a function.
 */
export function tokenizerEstimator(count: (text: string) => number, name = 'custom'): TokenEstimator {
  if (typeof count !== 'function') {
    throw new TypeError(
      'tokenizerEstimator: the first argument must be a function (text: string) => number, ' +
        'for example (t) => encode(t).length.',
    );
  }
  return {
    name: `tokenizer:${name}`,
    confidence: 'high',
    count(text: string): number {
      if (text.length === 0) return 0;
      const n = count(text);
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
        throw new RangeError(`tokenizerEstimator: the count function returned ${String(n)}, expected a number >= 0.`);
      }
      return Math.round(n);
    },
  };
}
