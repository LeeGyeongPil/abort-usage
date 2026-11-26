// Demo messages in English and Korean. All user-visible demo text lives in this one table.
export type Lang = 'en' | 'ko';

export const MESSAGES = {
  en: {
    title: 'abort-usage demo: what the AI SDK reports vs what abort-usage reports',
    mockNotice:
      'Practice mode: the provider is a mock model (no API key, no network). streamText, abort and the SDK callbacks are real.',
    colScenario: 'scenario',
    colSdk: 'AI SDK says',
    colTracker: 'abort-usage says',
    sdkFinish: '{input} in / {output} out',
    sdkAbortNone: 'nothing (onAbort got 0 steps)',
    sdkAbortFirstStepOnly: '{input} in / {output} out (finished step 1 only)',
    sdkErrorUndefined: 'undefined (onFinish totalUsage is empty)',
    trackerCell: '{input} in ({inputSource}) / {output} out ({outputSource})',
    outcome: 'outcome',
    confidence: 'confidence',
    totals: 'totals',
    reported: 'reported',
    estimated: 'estimated',
    warnings: 'warnings',
    none: 'none',
    desc_complete: 'The answer finishes normally.',
    desc_abort: 'The user presses stop after 4 words.',
    desc_provider_error: 'The provider connection resets mid-answer.',
    desc_multistep_abort: 'An agent finishes a tool step, then the user stops step 2.',
    footer: 'Estimated numbers are a lower bound: the provider may keep generating after the client stops.',
    usage: 'Usage: npm run demo -- [--lang en|ko] [--json]',
    badLang: 'Unknown language "{value}". Use --lang en or --lang ko.',
  },
  ko: {
    title: 'abort-usage 데모: AI SDK가 주는 사용량 vs abort-usage가 주는 사용량',
    mockNotice:
      '연습용 목(mock) 모드입니다: 공급자만 가짜 모델이고(API 키·네트워크 없음) streamText, 중단, SDK 콜백은 실제로 동작합니다.',
    colScenario: '시나리오',
    colSdk: 'AI SDK',
    colTracker: 'abort-usage',
    sdkFinish: '입력 {input} / 출력 {output}',
    sdkAbortNone: '없음 (onAbort 단계 0개)',
    sdkAbortFirstStepOnly: '입력 {input} / 출력 {output} (끝난 1단계만)',
    sdkErrorUndefined: 'undefined (onFinish totalUsage 비어 있음)',
    trackerCell: '입력 {input} ({inputSource}) / 출력 {output} ({outputSource})',
    outcome: '종료 방식',
    confidence: '신뢰도',
    totals: '합계',
    reported: '보고값',
    estimated: '추정값',
    warnings: '경고',
    none: '없음',
    desc_complete: '답변이 정상적으로 끝납니다.',
    desc_abort: '사용자가 4단어째에 중지를 누릅니다.',
    desc_provider_error: '답변 도중 공급자 연결이 끊깁니다.',
    desc_multistep_abort: '에이전트가 도구 단계를 마친 뒤 2단계에서 사용자가 중지합니다.',
    footer: '추정값은 하한입니다. 클라이언트가 멈춘 뒤에도 공급자는 계속 생성할 수 있습니다.',
    usage: '사용법: npm run demo -- [--lang en|ko] [--json]',
    badLang: '알 수 없는 언어 "{value}". --lang en 또는 --lang ko 를 쓰세요.',
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)['en'];

/** Fills `{name}` placeholders. */
export function t(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

function fromLocale(value: string | undefined): Lang | undefined {
  if (!value) return undefined;
  return value.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/**
 * Language priority: --lang flag > ABORT_USAGE_LANG > LC_ALL > LC_MESSAGES > LANG. Anything not Korean is English.
 * @throws Error if the --lang flag or ABORT_USAGE_LANG holds something other than en|ko.
 */
export function resolveLang(flag: string | undefined, env: Record<string, string | undefined>): Lang {
  for (const explicit of [flag, env.ABORT_USAGE_LANG]) {
    if (explicit === undefined || explicit === '') continue;
    const v = explicit.toLowerCase();
    if (v === 'en' || v === 'ko') return v;
    throw new Error(t('en', 'badLang', { value: explicit }));
  }
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const) {
    const found = fromLocale(env[key]);
    if (found) return found;
  }
  return 'en';
}
