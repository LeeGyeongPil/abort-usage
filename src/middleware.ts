import type { LanguageModelMiddleware } from 'ai';
import { charClassEstimator } from './estimators.ts';
import { promptToText } from './prompt-text.ts';
import { StepCollector, type FinishUsage } from './step-collector.ts';
import type { StepUsage, TokenEstimator } from './types.ts';

export interface UsageMiddlewareOptions {
  /** Called exactly once per model call (step), when the step has ended. Errors thrown here never break the stream. */
  onStep: (step: StepUsage) => void | Promise<void>;
  /** Token estimator for numbers the provider did not report. Default: `charClassEstimator()`. */
  estimator?: TokenEstimator;
  /** Add the `upstream-may-continue` warning to steps that did not finish normally. Default: `true`. */
  warnUpstreamMayContinue?: boolean;
  /** Receives errors thrown or rejected by `onStep`. Default: `console.warn`. */
  onCallbackError?: (error: unknown) => void;
}

/** Internal hooks used by `createUsageTracker`. Not part of the public API. */
export interface MiddlewareHooks {
  opened?: (collector: StepCollector) => void;
  closed?: (collector: StepCollector, step: StepUsage) => void;
}

type StreamParams = Parameters<NonNullable<LanguageModelMiddleware['wrapStream']>>[0]['params'];
type Part = { type: string } & Record<string, unknown>;

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return String((value as { message: unknown }).message);
  }
  return value === undefined ? 'unknown error' : String(value);
}

function readFinishUsage(chunk: Part): FinishUsage {
  const usage = (chunk.usage ?? {}) as { inputTokens?: Record<string, unknown>; outputTokens?: Record<string, unknown> };
  const out: FinishUsage = {};
  const inputTotal = num(usage.inputTokens?.total);
  const cacheRead = num(usage.inputTokens?.cacheRead);
  const cacheWrite = num(usage.inputTokens?.cacheWrite);
  const outputTotal = num(usage.outputTokens?.total);
  const reasoning = num(usage.outputTokens?.reasoning);
  if (inputTotal !== undefined) out.inputTotal = inputTotal;
  if (cacheRead !== undefined) out.inputCacheRead = cacheRead;
  if (cacheWrite !== undefined) out.inputCacheWrite = cacheWrite;
  if (outputTotal !== undefined) out.outputTotal = outputTotal;
  if (reasoning !== undefined) out.outputReasoning = reasoning;
  return out;
}

/**
 * Creates the AI SDK language model middleware. Use it with `wrapLanguageModel`.
 * One instance may be shared by many requests; `onStep` fires once per model call.
 */
export function usageMiddleware(options: UsageMiddlewareOptions): LanguageModelMiddleware {
  return createMiddleware(options, {});
}

/** @internal */
export function createMiddleware(options: UsageMiddlewareOptions, hooks: MiddlewareHooks): LanguageModelMiddleware {
  if (typeof options?.onStep !== 'function') {
    throw new TypeError('usageMiddleware: options.onStep must be a function (step) => void.');
  }
  const estimator = options.estimator ?? charClassEstimator();
  const warnUpstream = options.warnUpstreamMayContinue ?? true;
  let nextIndex = 0;

  const reportCallbackError = (error: unknown): void => {
    try {
      if (options.onCallbackError) options.onCallbackError(error);
      else console.warn('[abort-usage] onStep callback failed:', error);
    } catch {
      // the error handler itself failed, nothing more we can do without breaking the stream
    }
  };

  const emit = (step: StepUsage): void => {
    try {
      const result = options.onStep(step);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(reportCallbackError);
      }
    } catch (error) {
      reportCallbackError(error);
    }
  };

  const newCollector = (params: StreamParams): StepCollector => {
    let promptText = '';
    let messageCount = 0;
    let nonTextParts = 0;
    try {
      const p = promptToText(params.prompt, params.tools);
      ({ text: promptText, messageCount, nonTextParts } = p);
    } catch {
      // keep zeros: an unreadable prompt gives a lower-bound estimate instead of an exception
    }
    return new StepCollector({
      index: nextIndex++,
      estimator,
      promptText,
      messageCount,
      nonTextParts,
      warnUpstreamMayContinue: warnUpstream,
    });
  };

  return {
    specificationVersion: 'v4',
    wrapStream: async ({ doStream, params }) => {
      const collector = newCollector(params);
      hooks.opened?.(collector);
      const signal: AbortSignal | undefined = params.abortSignal;

      // Closes the step once and tells the outside world. Safe to call many times.
      const finish = (outcome: Parameters<StepCollector['close']>[0], error?: string): void => {
        signal?.removeEventListener('abort', onAbort);
        const step = collector.close(outcome, error);
        if (!step) return;
        try {
          hooks.closed?.(collector, step);
        } catch (e) {
          reportCallbackError(e);
        }
        emit(step);
      };
      // `onAbort` runs before the SDK's own onAbort callback and before the stream is cancelled.
      function onAbort(): void {
        finish('abort', messageOf(signal?.reason));
      }

      if (signal?.aborted) {
        // already aborted before the call started: nothing will stream, count the prompt only
        finish('abort', messageOf(signal.reason));
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }

      let result: Awaited<ReturnType<typeof doStream>>;
      try {
        result = await doStream();
      } catch (error) {
        finish(signal?.aborted ? 'abort' : 'error', messageOf(error));
        throw error;
      }

      // `cancel` is in the Streams spec but missing from some TypeScript lib versions
      const transformer: Transformer<Part, Part> & { cancel?: () => void } = {
        transform(chunk, controller) {
          try {
            switch (chunk.type) {
              case 'text-delta':
                if (typeof chunk.delta === 'string') collector.addText(chunk.delta);
                break;
              case 'reasoning-delta':
                if (typeof chunk.delta === 'string') collector.addReasoning(chunk.delta);
                break;
              case 'tool-input-delta':
                if (typeof chunk.delta === 'string') collector.addToolInput(chunk.delta);
                break;
              case 'tool-call':
                if (typeof chunk.input === 'string') collector.addToolCall(chunk.input);
                break;
              case 'finish': {
                const reason = (chunk.finishReason as { unified?: unknown } | undefined)?.unified;
                collector.setFinish(typeof reason === 'string' ? reason : undefined, readFinishUsage(chunk));
                finish('finish');
                break;
              }
              case 'error':
                finish('error', messageOf(chunk.error));
                break;
              default:
                break;
            }
          } catch (e) {
            reportCallbackError(e); // bookkeeping problems must never drop a chunk
          }
          controller.enqueue(chunk);
        },
        flush() {
          finish('ended-without-finish');
        },
        cancel() {
          finish('cancel');
        },
      };
      const transform = new TransformStream<Part, Part>(transformer);

      return { ...result, stream: (result.stream as ReadableStream<Part>).pipeThrough(transform) } as typeof result;
    },
  };
}
