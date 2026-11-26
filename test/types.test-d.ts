// Compile-time check (run by `tsc --noEmit`): the converted usage is assignable to the SDK's LanguageModelUsage.
import type { LanguageModelUsage } from 'ai';
import { toLanguageModelUsage, type UsageSummary, type StepUsage } from '../src/index.ts';

declare const summary: UsageSummary;
declare const step: StepUsage;
export const fromSummary: LanguageModelUsage = toLanguageModelUsage(summary);
export const fromStep: LanguageModelUsage = toLanguageModelUsage(step);
