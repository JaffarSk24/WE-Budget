import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import {
  LANGUAGES, DEFAULT_LANGUAGE, languageInfo, localeOf, decimalOf, dirOf, readyLanguages,
  languageOptions, matchBrowserLanguage, resolveLanguage
} from '../src/i18n/languages.js';
import { en } from '../src/i18n/en.js';
import { formatMoney, centsToInput, parseMoney } from '../src/money.js';
import { formatDate, formatDayYear, formatMonth, formatMonthShort, formatTime } from '../src/dates.js';
import { normalizeData } from '../src/model.js';

const dicts = {};
beforeAll(async () => {
  for (const l of LANGUAGES) {
    const mod = await import(`../src/i18n/${l.code}.js`);
    dicts[l.code] = mod[l.code];
  }
});

describe('language registry', () => {
  it('lists the languages in picker order with unique codes', () => {
    expect(LANGUAGES.map(l => l.code)).toEqual(['ru', 'uk', 'en', 'de', 'es', 'sk', 'cs']);
    expect(new Set(LANGUAGES.map(l => l.code)).size).toBe(LANGUAGES.length);
  });

  it('describes every language completely', () => {
    LANGUAGES.forEach(l => {
      expect(l.name, l.code).toBeTruthy();
      expect(l.english, l.code).toBeTruthy();
      expect(['ltr', 'rtl'], l.code).toContain(l.dir);
      expect([',', '.'], l.code).toContain(l.decimal);
      expect(typeof l.ready, l.code).toBe('boolean');
      expect(() => new Intl.NumberFormat(l.locale), l.code).not.toThrow();
      expect(existsSync(`src/i18n/${l.code}.js`), l.code).toBe(true);
      // English and Russian are bundled; every other file loads on demand.
      if (!['en', 'ru'].includes(l.code)) expect(typeof l.load, l.code).toBe('function');
    });
  });

  it('writes every current language left to right', () => {
    expect(LANGUAGES.filter(l => l.dir === 'rtl').map(l => l.code)).toEqual([]);
  });


  it('types the decimal separator the locale itself writes', () => {
    LANGUAGES.forEach(l => {
      const decimal = new Intl.NumberFormat(l.locale).formatToParts(1.5).find(p => p.type === 'decimal').value;
      expect(l.decimal, l.code).toBe(decimal);
    });
  });

  it('falls back to English for unknown codes', () => {
    expect(languageInfo('xx').code).toBe('en');
    expect(localeOf(undefined)).toBe('en-GB');
    expect(decimalOf('ru')).toBe(',');
    expect(dirOf('sk')).toBe('ltr');
  });

  it('offers only ready languages, plus a saved one that is not ready yet', () => {
    const ready = readyLanguages().map(l => l.code);
    expect(ready).toContain('en');
    expect(ready).toContain('ru');
    expect(languageOptions().map(o => o.value)).toEqual(ready);
    expect(languageOptions('en')).toContainEqual({ value: 'en', label: 'English' });
    const notReady = LANGUAGES.find(l => !l.ready);
    if (notReady) expect(languageOptions(notReady.code).map(o => o.value)).toContain(notReady.code);
  });
});

describe('first run language', () => {
  it('takes the first ready browser language by its primary subtag', () => {
    expect(matchBrowserLanguage(['ru-RU', 'en'])).toBe('ru');
    expect(matchBrowserLanguage(['de-DE', 'en-US'])).toBe('en');
    expect(matchBrowserLanguage(['de-DE'])).toBe(null);
    expect(matchBrowserLanguage([])).toBe(null);
    expect(matchBrowserLanguage(undefined)).toBe(null);
  });

  it('skips languages that are not ready', () => {
    const notReady = LANGUAGES.find(l => !l.ready);
    if (notReady) expect(matchBrowserLanguage([notReady.locale, 'ru'])).toBe('ru');
  });

  it('keeps a saved language and otherwise follows the browser, then English', () => {
    expect(resolveLanguage('ru', ['en-US'])).toBe('ru');
    expect(resolveLanguage('en', ['ru-RU'])).toBe('en');
    expect(resolveLanguage(null, ['ru-RU'])).toBe('ru');
    expect(resolveLanguage(null, ['de-DE'])).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage('xx', [])).toBe('en');
  });

  it('keeps Russian for budgets saved before the language followed the browser', () => {
    expect(normalizeData({ settings: { theme: 'light' } }).settings.language).toBe('ru');
    expect(normalizeData({ settings: { language: 'en' } }).settings.language).toBe('en');
    expect(normalizeData(null).settings.language).toBe(null);
    expect(normalizeData({ entries: [] }).settings.language).toBe(null);
  });
});

describe('locale files', () => {
  const keys = Object.keys(en).sort();
  // Plural families in English: prefix-one ... prefix-many.
  const pluralPrefixes = new Set(Object.keys(en).filter(k => k.endsWith('-many')).map(k => k.slice(0, -5)).filter(p => `${p}-one` in en));
  // Languages with more forms than English add them as extra keys.
  const extraAllowed = (key) => /-(zero|two)$/.test(key) && pluralPrefixes.has(key.replace(/-(zero|two)$/, ''));

  it('every language has exactly the keys of English (plus its own plural forms)', () => {
    LANGUAGES.forEach(l => {
      const dict = dicts[l.code];
      expect(dict, l.code).toBeTruthy();
      const own = Object.keys(dict);
      expect(keys.filter(k => !(k in dict)), `${l.code} misses`).toEqual([]);
      expect(own.filter(k => !(k in en) && !extraAllowed(k)), `${l.code} has unknown`).toEqual([]);
    });
  });

  it('every text is a string', () => {
    LANGUAGES.forEach(l => Object.entries(dicts[l.code]).forEach(([key, value]) => {
      expect(typeof value, `${l.code} ${key}`).toBe('string');
    }));
  });

  it('placeholders match English exactly', () => {
    const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    LANGUAGES.forEach(l => Object.entries(dicts[l.code]).forEach(([key, value]) => {
      const source = en[key] ?? en[key.replace(/-(zero|two)$/, '-many')];
      expect(names(value), `${l.code} ${key}`).toEqual(names(source));
    }));
  });

  it('ready languages have a key for every plural category the language uses', () => {
    const suffix = { zero: 'zero', one: 'one', two: 'two', few: 'few', many: 'many', other: 'many' };
    readyLanguages().forEach(l => {
      const categories = new Intl.PluralRules(l.locale).resolvedOptions().pluralCategories;
      pluralPrefixes.forEach(prefix => categories.forEach(c => {
        expect(`${prefix}-${suffix[c]}` in dicts[l.code], `${l.code} ${prefix}-${suffix[c]}`).toBe(true);
      }));
    });
  });

  it('no long dashes and no space before percent or currency signs', () => {
    LANGUAGES.forEach(l => Object.entries(dicts[l.code]).forEach(([key, value]) => {
      expect(value, `${l.code} ${key}`).not.toMatch(/[\u2013\u2014]/);
      expect(value, `${l.code} ${key}`).not.toMatch(/\s[%€]/);
      // Arabic and Urdu write their own percent sign and currency names.
      if (l.dir !== 'rtl') expect(value, `${l.code} ${key}`).not.toMatch(/\s[$£₴₽]/);
    }));
  });
});

describe('formatting in every language', () => {
  it('formats money with Latin or native digits and the symbol attached', () => {
    LANGUAGES.forEach(l => {
      const s = formatMoney(-245050, { lang: l.code }).replace(/[\u2066\u2069]/g, '');
      expect(s, l.code).toMatch(/^-.+€$/);
      expect(s, l.code).not.toMatch(/\s€/);
      // What the app writes, the app reads back (Bengali digits aside).
      if (/^-[0-9]/.test(s)) expect(parseMoney(formatMoney(-245050, { lang: l.code })), l.code).toBe(-245050);
    });
  });

  it('keeps the Russian and English amounts as before', () => {
    expect(formatMoney(245050, { lang: 'ru' })).toBe('2\u00a0450,50€');
    expect(formatMoney(245050, { lang: 'en' })).toBe('2,450.50€');
    expect(formatMoney(-1200, { lang: 'en', decimals: false })).toBe('-12€');
  });


  it('writes input values with the decimal separator people type', () => {
    expect(centsToInput(4735, 'ru')).toBe('47,35');
    expect(centsToInput(4735, 'en')).toBe('47.35');
    LANGUAGES.forEach(l => {
      expect(centsToInput(4735, l.code), l.code).toBe(`47${l.decimal}35`);
      expect(parseMoney(centsToInput(4735, l.code)), l.code).toBe(4735);
    });
  });

  it('formats dates in every locale with the year and the day', () => {
    LANGUAGES.forEach(l => {
      const date = formatDate('2026-11-01', l.code);
      expect(date, l.code).toBeTruthy();
      expect(date, l.code).not.toMatch(/\s$/);
      expect(formatMonth('2026-11', l.code), l.code).toBeTruthy();
      expect(formatDayYear('2026-11-01', l.code), l.code).toBeTruthy();
      expect(formatTime('2026-11-01T13:05:00Z', l.code), l.code).toBeTruthy();
    });
    expect(formatDate('2026-11-01', 'ru')).toBe('1 ноября 2026');
    expect(formatDate('2026-11-01', 'en')).toBe('1 November 2026');
  });

  it('keeps the Russian day with year as before', () => {
    expect(formatDayYear('2026-10-05', 'ru')).toBe('05.10.2026');
    expect(formatDayYear('2026-10-05', 'ru', { shortYear: true })).toBe('05.10.26');
    expect(formatDayYear('2026-10-05', 'en')).toBe('05/10/2026');
  });
});

describe('short month labels', () => {
  it('keeps three letter English months and the Russian form', () => {
    expect(formatMonthShort('2026-09', 'en')).toBe('Sep 26');
    expect(formatMonthShort('2026-10', 'en')).toBe('Oct 26');
    expect(formatMonthShort('2026-10', 'ru')).toMatch(/^окт/);
  });
});
