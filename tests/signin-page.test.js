import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { LANGUAGES } from '../src/i18n/languages.js';

const require = createRequire(import.meta.url);
const { signInPage, SIGNIN_LANGUAGES } = require('../main/signin-page.cjs');

describe('the browser page after Google sign-in', () => {
  it('speaks every interface language', () => {
    expect([...SIGNIN_LANGUAGES].sort()).toEqual(LANGUAGES.map(l => l.code).sort());
  });

  it('is in the language passed, right to left for Arabic and Urdu', () => {
    LANGUAGES.forEach(l => ['ok', 'fail', 'scope'].forEach(outcome => {
      const html = signInPage(l.code, outcome);
      expect(html, l.code).toContain(`<html lang="${l.code}" dir="${l.dir}">`);
      expect(html, l.code).not.toMatch(/undefined|[\u2013\u2014]|\s[%€]/);
    }));
    expect(signInPage('ru', 'ok')).toContain('Google-аккаунт подключён');
    expect(signInPage('es', 'scope')).toContain('Google Drive');
  });

  it('falls back to English for an unknown language', () => {
    expect(signInPage('xx', 'fail')).toContain('Sign-in failed');
    expect(signInPage(undefined, 'ok')).toContain('<html lang="en" dir="ltr">');
  });
});
