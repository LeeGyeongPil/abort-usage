import type { LanguageModelUsage } from 'ai';
import { summarize } from './tracker.ts';
import type { StepUsage, UsageSummary } from './types.ts';

/**
 * Converts a summary (or a single step) into the AI SDK's `LanguageModelUsage` shape, so it can be
 * passed to code that already understands it (cost tools, billing hooks).
 * Estimated numbers are included as-is: check `summary.estimatedTokens` if you need to tell them apart.
 */
export function toLanguageModelUsage(usage: UsageSummary | StepUsage): LanguageModelUsage {
  const summary = 'steps' in usage ? usage : summarize([usage]);
  let cacheRead: number | undefined;
  let cacheWrite: number | undefined;
  let reasoning: number | undefined;
  for (const step of summary.steps) {
    if (step.input.cacheReadTokens !== undefined) cacheRead = (cacheRead ?? 0) + step.input.cacheReadTokens;
    if (step.input.cacheWriteTokens !== undefined) cacheWrite = (cacheWrite ?? 0) + step.input.cacheWriteTokens;
    if (step.output.reasoningTokens !== undefined) reasoning = (reasoning ?? 0) + step.output.reasoningTokens;
  }
  return {
    inputTokens: summary.inputTokens,
    inputTokenDetails: {
      noCacheTokens: cacheRead === undefined ? undefined : Math.max(0, summary.inputTokens - cacheRead),
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    },
    outputTokens: summary.outputTokens,
    outputTokenDetails: {
      textTokens: reasoning === undefined ? undefined : Math.max(0, summary.outputTokens - reasoning),
      reasoningTokens: reasoning,
    },
    totalTokens: summary.totalTokens,
  };
}
