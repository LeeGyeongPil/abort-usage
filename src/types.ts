/** Public types of abort-usage. */

/** How a model call (one "step" of a streamText run) ended. */
export type StepOutcome =
  | 'finish' // the provider sent its final chunk, usage is the provider's number
  | 'abort' // the request's AbortSignal fired (user pressed stop, timeout, ...)
  | 'error' // the provider sent an error chunk or doStream threw
  | 'cancel' // the consumer cancelled the stream without an AbortSignal
  | 'ended-without-finish' // the stream closed but no finish chunk was seen
  | 'open'; // still running; only appears in a tracker snapshot

/** Where a number came from. */
export type UsageSource = 'reported' | 'estimated';

/** Warning codes attached to steps. Stable strings, safe to switch on. */
export type UsageWarning =
  /** The provider may keep generating (and billing) after the client stopped, the estimate is a lower bound. */
  | 'upstream-may-continue'
  /** A character-class heuristic produced at least one number. */
  | 'heuristic-estimate'
  /** The finish chunk arrived but a usage number was missing, so that number was estimated. */
  | 'reported-usage-missing'
  /** The prompt contains images or files that were not counted. */
  | 'non-text-input-not-counted'
  /** The provider reported reasoning tokens but no reasoning text was streamed. */
  | 'reasoning-not-streamed';

export type Confidence = 'exact' | 'high' | 'low';

/** Token usage of one model call. */
export interface StepUsage {
  /** 0-based position among the calls seen by this middleware instance. */
  index: number;
  outcome: StepOutcome;
  finishReason?: string;
  /** Error message when `outcome` is `error` (or the abort reason for `abort`). */
  error?: string;
  input: {
    tokens: number;
    source: UsageSource;
    /** Estimator name, e.g. `char-class` or `tokenizer:o200k`. Absent for reported numbers. */
    method?: string;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  output: {
    tokens: number;
    source: UsageSource;
    method?: string;
    reasoningTokens?: number;
    /** Characters actually received from the provider before the step ended. */
    chars: { text: number; reasoning: number; toolInput: number };
  };
  /** `exact` = provider numbers, `high` = injected tokenizer, `low` = heuristic. Mixed steps get the lowest. */
  confidence: Confidence;
  warnings: UsageWarning[];
}

/** Sum over all steps seen so far. */
export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Tokens (input + output) that came from the provider. */
  reportedTokens: number;
  /** Tokens (input + output) that were estimated. */
  estimatedTokens: number;
  /** `false` while at least one step is still open. */
  complete: boolean;
  confidence: Confidence;
  /** Union of the step warnings. */
  warnings: UsageWarning[];
  steps: StepUsage[];
}

/** Turns text into a token count. */
export interface TokenEstimator {
  name: string;
  confidence: 'high' | 'low';
  count(text: string): number;
}

/** Tokens per character for each character class. All values must be finite and greater than 0. */
export interface CharClassCoefficients {
  hangul: number;
  cjk: number;
  word: number;
  space: number;
  symbol: number;
}
