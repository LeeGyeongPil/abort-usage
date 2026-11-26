import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { createMiddleware, type UsageMiddlewareOptions } from './middleware.ts';
import type { StepCollector } from './step-collector.ts';
import type { Confidence, StepUsage, UsageSummary, UsageWarning } from './types.ts';

export type TrackerOptions = Omit<UsageMiddlewareOptions, 'onStep'> & {
  /** Optional extra callback, called once per finished step (after it was added to `steps`). */
  onStep?: (step: StepUsage) => void | Promise<void>;
};

/** Language model type accepted by `wrapLanguageModel` (kept loose to avoid a direct provider dependency). */
type Model = Parameters<typeof wrapLanguageModel>[0]['model'];

export interface UsageTracker {
  /** The middleware to pass to `wrapLanguageModel`. */
  readonly middleware: LanguageModelMiddleware;
  /** Wraps a model so every call made through it is tracked. */
  wrap(model: Model): ReturnType<typeof wrapLanguageModel>;
  /** Steps that have ended, in the order they ended. */
  readonly steps: readonly StepUsage[];
  /** Totals so far. Steps that are still running are included as `open` with an estimate. */
  summary(): UsageSummary;
}

const RANK: Record<Confidence, number> = { low: 0, high: 1, exact: 2 };

/**
 * One tracker per request: collects every model call (agent step) made through the wrapped model.
 * For a model shared by many requests use `usageMiddleware({ onStep })` instead.
 */
export function createUsageTracker(options: TrackerOptions = {}): UsageTracker {
  const closed: StepUsage[] = [];
  const open = new Set<StepCollector>();
  const { onStep, ...rest } = options;

  const middleware = createMiddleware(
    {
      ...rest,
      onStep: (step) => onStep?.(step),
    },
    {
      opened: (collector) => open.add(collector),
      closed: (collector, step) => {
        open.delete(collector);
        closed.push(step);
      },
    },
  );

  return {
    middleware,
    wrap: (model) => wrapLanguageModel({ model, middleware }),
    get steps() {
      return closed;
    },
    summary(): UsageSummary {
      const steps = [...closed, ...[...open].map((c) => c.snapshot())].sort((a, b) => a.index - b.index);
      return summarize(steps);
    },
  };
}

/** Sums steps into a `UsageSummary`. Exposed for callers that collect steps themselves via `onStep`. */
export function summarize(steps: readonly StepUsage[]): UsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let reportedTokens = 0;
  let estimatedTokens = 0;
  let confidence: Confidence = 'exact';
  const warnings = new Set<UsageWarning>();
  for (const step of steps) {
    inputTokens += step.input.tokens;
    outputTokens += step.output.tokens;
    if (step.input.source === 'reported') reportedTokens += step.input.tokens;
    else estimatedTokens += step.input.tokens;
    if (step.output.source === 'reported') reportedTokens += step.output.tokens;
    else estimatedTokens += step.output.tokens;
    if (RANK[step.confidence] < RANK[confidence]) confidence = step.confidence;
    for (const w of step.warnings) warnings.add(w);
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    reportedTokens,
    estimatedTokens,
    complete: !steps.some((s) => s.outcome === 'open'),
    confidence,
    warnings: [...warnings],
    steps: [...steps],
  };
}
