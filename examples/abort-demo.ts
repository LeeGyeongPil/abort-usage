// Demo: four ways a streamed answer can end, and what the AI SDK vs abort-usage reports for each.
// Run: npm run demo            (English)   npm run demo -- --lang ko   npm run demo -- --json
import { parseArgs } from 'node:util';
import { runScenario, SCENARIO_NAMES, type ScenarioResult } from '../test/helpers/scenarios.ts';
import { resolveLang, t, type Lang, type MessageKey } from './i18n.ts';

const { values } = parseArgs({
  options: { lang: { type: 'string' }, json: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } },
});

let lang: Lang;
try {
  lang = resolveLang(values.lang, process.env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

if (values.help) {
  console.log(t(lang, 'usage'));
  process.exit(0);
}

// 시나리오를 차례로 실행한다 (진짜 streamText + 목 공급자)
const results: ScenarioResult[] = [];
for (const name of SCENARIO_NAMES) results.push(await runScenario(name));

if (values.json) {
  console.log(JSON.stringify(results.map((r) => ({ scenario: r.name, ...r.summary })), null, 2));
  process.exit(0);
}

// SDK 쪽 숫자를 사람이 읽는 문장으로 바꾼다
function sdkCell(r: ScenarioResult): string {
  if (r.name === 'complete') {
    return t(lang, 'sdkFinish', { input: r.sdk.finishTotalUsage?.inputTokens ?? '?', output: r.sdk.finishTotalUsage?.outputTokens ?? '?' });
  }
  if (r.name === 'provider-error') return t(lang, 'sdkErrorUndefined');
  const first = r.sdk.abortStepUsages?.[0];
  if (!first) return t(lang, 'sdkAbortNone');
  return t(lang, 'sdkAbortFirstStepOnly', { input: first.inputTokens ?? '?', output: first.outputTokens ?? '?' });
}

// abort-usage 쪽은 마지막 단계의 출처(보고/추정)를 함께 보여 준다
function trackerCell(r: ScenarioResult): string {
  const s = r.summary;
  const reportedIn = s.steps.every((x) => x.input.source === 'reported');
  const reportedOut = s.steps.every((x) => x.output.source === 'reported');
  const label = (reported: boolean) => t(lang, reported ? 'reported' : 'estimated');
  return t(lang, 'trackerCell', {
    input: s.inputTokens,
    output: s.outputTokens,
    inputSource: s.steps.some((x) => x.input.source === 'reported') && !reportedIn ? `${t(lang, 'reported')}+${t(lang, 'estimated')}` : label(reportedIn),
    outputSource: s.steps.some((x) => x.output.source === 'reported') && !reportedOut ? `${t(lang, 'reported')}+${t(lang, 'estimated')}` : label(reportedOut),
  });
}

const descKey = (name: string) => `desc_${name.replaceAll('-', '_')}` as MessageKey;
const rows = results.map((r) => [r.name, sdkCell(r), trackerCell(r)] as const);
const header = [t(lang, 'colScenario'), t(lang, 'colSdk'), t(lang, 'colTracker')] as const;
// 한글은 터미널에서 두 칸을 차지하므로 너비를 직접 계산한다
const width = (text: string) => [...text].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? 2 : 1), 0);
const pad = (text: string, size: number) => text + ' '.repeat(Math.max(0, size - width(text)));
const sizes = [0, 1, 2].map((i) => Math.max(width(header[i]!), ...rows.map((row) => width(row[i]!))));

console.log(t(lang, 'title'));
console.log(t(lang, 'mockNotice'));
console.log();
console.log(header.map((h, i) => pad(h, sizes[i]!)).join('  |  '));
console.log(sizes.map((n) => '-'.repeat(n)).join('--+--'));
for (const row of rows) console.log(row.map((c, i) => pad(c, sizes[i]!)).join('  |  '));
console.log();
for (const r of results) {
  const last = r.summary.steps[r.summary.steps.length - 1]!;
  const warnings = r.summary.warnings.length ? r.summary.warnings.join(', ') : t(lang, 'none');
  console.log(`${r.name}: ${t(lang, descKey(r.name))}`);
  console.log(
    `  ${t(lang, 'outcome')}=${last.outcome}  ${t(lang, 'confidence')}=${r.summary.confidence}  ` +
      `${t(lang, 'reported')}=${r.summary.reportedTokens}  ${t(lang, 'estimated')}=${r.summary.estimatedTokens}  ` +
      `${t(lang, 'totals')}=${r.summary.totalTokens}`,
  );
  console.log(`  ${t(lang, 'warnings')}: ${warnings}`);
}
console.log();
console.log(t(lang, 'footer'));
