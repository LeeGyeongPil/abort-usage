import { charClassEstimator } from './estimators.ts';
import type { Confidence, StepOutcome, StepUsage, TokenEstimator, UsageWarning } from './types.ts';

/** Fixed token overhead per prompt message (role markers, separators). Rough, OpenAI-style chat template. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** Provider usage as it appears on a `finish` chunk (every field may be missing). */
export interface FinishUsage {
  inputTotal?: number;
  inputCacheRead?: number;
  inputCacheWrite?: number;
  outputTotal?: number;
  outputReasoning?: number;
}

export interface CollectorInit {
  index: number;
  estimator: TokenEstimator;
  promptText: string;
  messageCount: number;
  nonTextParts: number;
  warnUpstreamMayContinue: boolean;
}

const RANK: Record<Confidence, number> = { low: 0, high: 1, exact: 2 };

function lowest(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Accumulates what one model call has produced so far and builds its `StepUsage`. */
export class StepCollector {
  readonly index: number;
  private readonly init: CollectorInit;
  private text = '';
  private reasoning = '';
  private toolInput = '';
  private toolCallInputs: string[] = [];
  private finishReason: string | undefined;
  private finishUsage: FinishUsage | undefined;
  private closed: StepUsage | undefined;

  constructor(init: CollectorInit) {
    this.init = init;
    this.index = init.index;
  }

  get isClosed(): boolean {
    return this.closed !== undefined;
  }

  addText(delta: string): void {
    this.text += delta;
  }

  addReasoning(delta: string): void {
    this.reasoning += delta;
  }

  addToolInput(delta: string): void {
    this.toolInput += delta;
  }

  /** A complete tool call; used only when its argument deltas were not streamed. */
  addToolCall(input: string): void {
    this.toolCallInputs.push(input);
  }

  setFinish(reason: string | undefined, usage: FinishUsage): void {
    this.finishReason = reason;
    this.finishUsage = usage;
  }

  /** Closes the step. Returns the final record the first time, `undefined` afterwards. */
  close(outcome: Exclude<StepOutcome, 'open'>, error?: string): StepUsage | undefined {
    if (this.closed) return undefined;
    this.closed = this.build(outcome, error);
    return this.closed;
  }

  /** Current state as an `open` step (or the final record if already closed). */
  snapshot(): StepUsage {
    return this.closed ?? this.build('open');
  }

  private estimate(text: string): { tokens: number; estimator: TokenEstimator } {
    try {
      return { tokens: this.init.estimator.count(text), estimator: this.init.estimator };
    } catch {
      // A broken injected tokenizer must not break the stream: fall back to the heuristic.
      const fallback = charClassEstimator();
      return { tokens: fallback.count(text), estimator: fallback };
    }
  }

  private build(outcome: StepOutcome, error?: string): StepUsage {
    const warnings = new Set<UsageWarning>();
    const usage = this.finishUsage;
    const toolInputText = this.toolInput || this.toolCallInputs.join('');
    const chars = { text: this.text.length, reasoning: this.reasoning.length, toolInput: toolInputText.length };
    let confidence: Confidence = 'exact';

    const noteEstimate = (estimator: TokenEstimator): string => {
      confidence = lowest(confidence, estimator.confidence);
      if (estimator.confidence === 'low') warnings.add('heuristic-estimate');
      return estimator.name;
    };

    // ---- input ----
    const input: StepUsage['input'] = { tokens: 0, source: 'reported' };
    if (usage?.inputTotal !== undefined) {
      input.tokens = usage.inputTotal;
      if (usage.inputCacheRead !== undefined) input.cacheReadTokens = usage.inputCacheRead;
      if (usage.inputCacheWrite !== undefined) input.cacheWriteTokens = usage.inputCacheWrite;
    } else {
      const { tokens, estimator } = this.estimate(this.init.promptText);
      input.tokens = tokens + this.init.messageCount * MESSAGE_OVERHEAD_TOKENS;
      input.source = 'estimated';
      input.method = noteEstimate(estimator);
      if (usage) warnings.add('reported-usage-missing');
      if (this.init.nonTextParts > 0) warnings.add('non-text-input-not-counted');
    }

    // ---- output ----
    const output: StepUsage['output'] = { tokens: 0, source: 'reported', chars };
    if (usage?.outputTotal !== undefined) {
      output.tokens = usage.outputTotal;
      if (usage.outputReasoning !== undefined) output.reasoningTokens = usage.outputReasoning;
    } else {
      const parts = [this.text, this.reasoning, toolInputText];
      let tokens = 0;
      let used: TokenEstimator = this.init.estimator;
      for (const part of parts) {
        const e = this.estimate(part);
        tokens += e.tokens;
        if (e.estimator !== this.init.estimator) used = e.estimator; // a fallback was needed
      }
      output.tokens = tokens;
      output.source = 'estimated';
      output.method = noteEstimate(used);
      if (usage) {
        warnings.add('reported-usage-missing');
        if ((usage.outputReasoning ?? 0) > 0 && chars.reasoning === 0) {
          output.reasoningTokens = usage.outputReasoning as number;
          warnings.add('reasoning-not-streamed');
        }
      }
    }

    if (
      this.init.warnUpstreamMayContinue &&
      (outcome === 'abort' || outcome === 'cancel' || outcome === 'error' || outcome === 'ended-without-finish')
    ) {
      warnings.add('upstream-may-continue');
    }

    const step: StepUsage = {
      index: this.index,
      outcome,
      input,
      output,
      confidence,
      warnings: [...warnings],
    };
    if (this.finishReason !== undefined) step.finishReason = this.finishReason;
    if (error !== undefined) step.error = error;
    return step;
  }
}
