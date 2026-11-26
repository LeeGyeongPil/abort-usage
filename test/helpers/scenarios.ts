// Runs a real streamText call against a mock model and records what the SDK reports
// next to what abort-usage reports. Shared by the tests and by the demo.
import { isStepCount, jsonSchema, streamText, tool } from 'ai';
import { createUsageTracker, type UsageSummary, type UsageTracker } from '../../src/index.ts';
import { errorModel, textModel, toolThenTextModel } from './mock-models.ts';

export type ScenarioName = 'complete' | 'abort' | 'provider-error' | 'multistep-abort';
export const SCENARIO_NAMES: readonly ScenarioName[] = ['complete', 'abort', 'provider-error', 'multistep-abort'];

export interface SdkView {
  /** Which SDK callback fired: onFinish, onAbort or onError+onFinish. */
  callbacks: string[];
  /** `totalUsage` as the SDK's onFinish saw it (undefined if onFinish never fired). */
  finishTotalUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  /** Usage of the steps the SDK passed to onAbort (finished steps only). */
  abortStepUsages?: Array<{ inputTokens?: number; outputTokens?: number }>;
}

export interface ScenarioResult {
  name: ScenarioName;
  sdk: SdkView;
  summary: UsageSummary;
  /** `tracker.summary()` read inside the SDK's onAbort callback (abort scenarios only). */
  summaryInOnAbort?: UsageSummary;
  receivedText: string;
  tracker: UsageTracker;
  /** Number of onStep calls (exactly one per ended step). */
  onStepCalls: number;
}

export interface RunOptions {
  /** Abort the request after the consumer received this many text deltas. */
  abortAfterDeltas?: number;
  /** Cancel the consumer (no AbortSignal) after this many text deltas. */
  cancelAfterDeltas?: number;
  model?: unknown;
  trackerOptions?: Parameters<typeof createUsageTracker>[0];
  prompt?: string;
  maxSteps?: number;
  tools?: Record<string, never>;
}

const lookup = tool({
  description: 'Look up a short fact about tokens.',
  inputSchema: jsonSchema({ type: 'object', properties: { q: { type: 'string' } } }),
  execute: async () => 'Tokens are the unit that language models read and write. '.repeat(4),
});

export async function runStream(opts: RunOptions & { model: unknown }): Promise<Omit<ScenarioResult, 'name'>> {
  let onStepCalls = 0;
  const tracker = createUsageTracker({
    ...opts.trackerOptions,
    onStep: (s) => {
      onStepCalls++;
      return opts.trackerOptions?.onStep?.(s);
    },
  });
  const controller = new AbortController();
  const sdk: SdkView = { callbacks: [] };
  let summaryInOnAbort: UsageSummary | undefined;
  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => (settle = resolve));

  const result = streamText({
    model: tracker.wrap(opts.model as never),
    prompt: opts.prompt ?? 'Explain token accounting in one short paragraph.',
    abortSignal: controller.signal,
    tools: opts.tools ?? (opts.maxSteps && opts.maxSteps > 1 ? ({ lookup } as never) : undefined),
    stopWhen: isStepCount(opts.maxSteps ?? 1),
    onFinish: (e) => {
      sdk.callbacks.push('onFinish');
      sdk.finishTotalUsage = {
        inputTokens: e.totalUsage.inputTokens,
        outputTokens: e.totalUsage.outputTokens,
        totalTokens: e.totalUsage.totalTokens,
      };
      settle();
    },
    onAbort: (e) => {
      sdk.callbacks.push('onAbort');
      sdk.abortStepUsages = e.steps.map((s) => ({
        inputTokens: s.usage.inputTokens,
        outputTokens: s.usage.outputTokens,
      }));
      summaryInOnAbort = tracker.summary();
      settle();
    },
    onError: () => {
      sdk.callbacks.push('onError');
    },
  });

  let receivedText = '';
  let deltas = 0;
  try {
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        receivedText += part.text;
        deltas++;
        if (opts.abortAfterDeltas !== undefined && deltas === opts.abortAfterDeltas) {
          controller.abort(new Error('user pressed stop'));
        }
        if (opts.cancelAfterDeltas !== undefined && deltas === opts.cancelAfterDeltas) break;
      }
    }
  } catch {
    // the SDK may rethrow the abort or the provider error while we iterate
  }
  if (opts.cancelAfterDeltas === undefined) await done;
  else await new Promise((r) => setTimeout(r, 30));

  const out: Omit<ScenarioResult, 'name'> = {
    sdk,
    summary: tracker.summary(),
    receivedText,
    tracker,
    onStepCalls,
  };
  if (summaryInOnAbort) out.summaryInOnAbort = summaryInOnAbort;
  return out;
}

export async function runScenario(name: ScenarioName): Promise<ScenarioResult> {
  switch (name) {
    case 'complete':
      return { name, ...(await runStream({ model: textModel() })) };
    case 'abort':
      return { name, ...(await runStream({ model: textModel({ delayMs: 10 }), abortAfterDeltas: 4 })) };
    case 'provider-error':
      return { name, ...(await runStream({ model: errorModel(5) })) };
    case 'multistep-abort':
      return {
        name,
        ...(await runStream({ model: toolThenTextModel(10), maxSteps: 3, abortAfterDeltas: 4 })),
      };
  }
}
