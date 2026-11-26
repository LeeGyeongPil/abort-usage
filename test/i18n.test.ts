import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { MESSAGES, resolveLang } from '../examples/i18n.ts';

// AC-9: language selection for the demo
test('en and ko message tables have exactly the same keys', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
  for (const lang of ['en', 'ko'] as const) {
    for (const [key, value] of Object.entries(MESSAGES[lang])) assert.ok(value.length > 0, `${lang}.${key} is empty`);
  }
});

test('language priority: --lang > ABORT_USAGE_LANG > LC_ALL > LC_MESSAGES > LANG, default English', () => {
  assert.equal(resolveLang('ko', { ABORT_USAGE_LANG: 'en', LANG: 'en_US.UTF-8' }), 'ko');
  assert.equal(resolveLang(undefined, { ABORT_USAGE_LANG: 'ko', LANG: 'en_US.UTF-8' }), 'ko');
  assert.equal(resolveLang(undefined, { LC_ALL: 'ko_KR.UTF-8', LC_MESSAGES: 'en_US', LANG: 'en_US' }), 'ko');
  assert.equal(resolveLang(undefined, { LC_MESSAGES: 'ko_KR.UTF-8', LANG: 'en_US' }), 'ko');
  assert.equal(resolveLang(undefined, { LANG: 'ko_KR.UTF-8' }), 'ko');
  assert.equal(resolveLang(undefined, { LANG: 'fr_FR.UTF-8' }), 'en');
  assert.equal(resolveLang(undefined, {}), 'en');
  assert.equal(resolveLang('en', { LANG: 'ko_KR.UTF-8' }), 'en');
});

test('an unknown --lang value is rejected with a hint', () => {
  assert.throws(() => resolveLang('fr', {}), /--lang en or --lang ko/);
});

function demo(args: string[], env: Record<string, string> = {}) {
  const clean = { PATH: process.env.PATH ?? '', ...env };
  return spawnSync(process.execPath, ['examples/abort-demo.ts', ...args], { encoding: 'utf8', env: clean, timeout: 30000 });
}

test('the demo output actually switches language', () => {
  const ko = demo(['--lang', 'ko']);
  assert.equal(ko.status, 0, ko.stderr);
  assert.match(ko.stdout, /연습용 목\(mock\) 모드/);
  assert.match(ko.stdout, /시나리오/);
  const en = demo(['--lang', 'en'], { LANG: 'ko_KR.UTF-8' });
  assert.equal(en.status, 0, en.stderr);
  assert.match(en.stdout, /Practice mode/);
  assert.match(en.stdout, /scenario/);
  assert.doesNotMatch(en.stdout, /시나리오/);
  const viaEnv = demo([], { ABORT_USAGE_LANG: 'ko' });
  assert.match(viaEnv.stdout, /시나리오/);
});

// AC-8: the demo shows all four scenarios and both kinds of numbers
test('the demo prints four scenarios with reported and estimated numbers', () => {
  const out = demo(['--lang', 'en']);
  assert.equal(out.status, 0, out.stderr);
  for (const name of ['complete', 'abort', 'provider-error', 'multistep-abort']) assert.match(out.stdout, new RegExp(name));
  assert.match(out.stdout, /estimated/);
  assert.match(out.stdout, /reported/);
  assert.match(out.stdout, /undefined \(onFinish totalUsage is empty\)/);
  assert.match(out.stdout, /nothing \(onAbort got 0 steps\)/);
  assert.match(out.stdout, /30 in \/ 12 out \(finished step 1 only\)/);
});

test('the demo --json prints four UsageSummary objects', () => {
  const out = demo(['--json']);
  assert.equal(out.status, 0, out.stderr);
  const parsed = JSON.parse(out.stdout) as Array<{ scenario: string; steps: unknown[]; totalTokens: number }>;
  assert.deepEqual(parsed.map((p) => p.scenario), ['complete', 'abort', 'provider-error', 'multistep-abort']);
  assert.equal(parsed[3]!.steps.length, 2);
  assert.ok(parsed.every((p) => p.totalTokens > 0));
});

test('the demo exits non-zero on a bad --lang', () => {
  const out = demo(['--lang', 'xx']);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /--lang en or --lang ko/);
});
