import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ru } from '../src/i18n/ru.js';
import { en } from '../src/i18n/en.js';
import { store } from '../src/store.js';
import { t, tn, flow, pluralSuffix, translations, currentLang, ensureLanguage, isLanguageLoaded } from '../src/i18n.js';
import { LANGUAGES } from '../src/i18n/languages.js';

function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.js') ? [p] : [];
  });
}

describe('translations', () => {
  it('both languages have the same keys', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it('every key used in the code exists', () => {
    const text = sources('src').map(p => readFileSync(p, 'utf8')).join('\n') + readFileSync('index.html', 'utf8');
    const used = new Set();
    for (const m of text.matchAll(/\bt\('([a-zA-Z0-9-]+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/data-i18n="([a-zA-Z0-9-]+)"/g)) used.add(m[1]);
    for (const m of text.matchAll(/\btn\('([a-zA-Z0-9-]+)'/g)) ['one', 'few', 'many'].forEach(f => used.add(`${m[1]}-${f}`));
    const missing = [...used].filter(k => !(k in ru));
    expect(missing).toEqual([]);
  });

  it('no long dashes and no space before currency or percent in any text', () => {
    [ru, en].forEach(dict => Object.entries(dict).forEach(([key, value]) => {
      expect(value, key).not.toMatch(/[\u2013\u2014]/);
      expect(value, key).not.toMatch(/\s[%€]/);
    }));
  });
});

describe('plurals', () => {
  let saved;
  beforeAll(() => { saved = store.settings.language; });
  afterAll(() => { store.settings.language = saved; delete translations.de; });

  it('maps CLDR categories to key suffixes', () => {
    expect([1, 2, 5, 11, 21, 22, 1.5].map(n => pluralSuffix('ru', n))).toEqual(['one', 'few', 'many', 'many', 'one', 'few', 'many']);
    expect([0, 1, 2, 1.5].map(n => pluralSuffix('en', n))).toEqual(['many', 'one', 'many', 'many']);
    expect([1, 2, 5, 1.5].map(n => pluralSuffix('cs', n))).toEqual(['one', 'few', 'many', 'many']);
    expect([1, 2, 5].map(n => pluralSuffix('de', n))).toEqual(['one', 'many', 'many']);
    expect([0, 1, 2, 3, 11, 100].map(n => pluralSuffix('ar', n))).toEqual(['zero', 'one', 'two', 'few', 'many', 'many']);
    expect([1, 2].map(n => pluralSuffix('zh', n))).toEqual(['many', 'many']);
  });

  it('keeps Russian and English plural texts as before', () => {
    store.settings.language = 'ru';
    expect(tn('cal-entries', 1)).toBe(ru['cal-entries-one'].replace('{n}', '1'));
    expect(tn('cal-entries', 3)).toBe(ru['cal-entries-few'].replace('{n}', '3'));
    expect(tn('cal-entries', 12)).toBe(ru['cal-entries-many'].replace('{n}', '12'));
    store.settings.language = 'en';
    expect(tn('cal-entries', 1)).toBe(en['cal-entries-one'].replace('{n}', '1'));
    expect(tn('cal-entries', 3)).toBe(en['cal-entries-many'].replace('{n}', '3'));
  });

  it('falls back to the -many form when a language has no key for a form', () => {
    // A German file without a -few key falls back to -many.
    store.settings.language = 'de';
    translations.de = { ...en, 'cal-entries-few': undefined };
    expect(tn('cal-entries', 2)).toBe(en['cal-entries-many'].replace('{n}', '2'));
    expect(t('nav-month')).toBe(en['nav-month']);
  });

  it('shows English, then the key, for texts a language lacks', () => {
    store.settings.language = 'ru';
    translations.ru = { ...ru, 'nav-month': undefined };
    try {
      expect(t('nav-month')).toBe(en['nav-month']);
      expect(t('no-such-key')).toBe('no-such-key');
    } finally {
      translations.ru = ru;
    }
  });

  it('a registered language is the current one even before it is ready', () => {
    store.settings.language = 'de';
    expect(currentLang()).toBe('de');
    store.settings.language = 'xx';
    expect(LANGUAGES.map(l => l.code)).toContain(currentLang());
  });

  it('loads a language file on first use', async () => {
    expect(isLanguageLoaded('sk')).toBe(false);
    expect(await ensureLanguage('sk')).toBe(true);
    expect(translations.sk['nav-month']).toBeTruthy();
    expect(await ensureLanguage('xx')).toBe(false);
  });

  it('points the arrow between two accounts the way the text reads', () => {
    store.settings.language = 'en';
    expect(flow('Main', 'Bills')).toBe('Main \u2192 Bills');
    store.settings.language = 'ar';
    expect(flow('Main', 'Bills')).toBe('\u2068Main\u2069 \u2190 \u2068Bills\u2069');
  });
});
