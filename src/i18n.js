// Interface texts. Keys are looked up in the current language, then in
// English, then the key itself is shown (a missing key is visible, not
// silent). {name} placeholders are filled from params. The languages and
// their locales live in i18n/languages.js.

import { store } from './store.js';
import { ru } from './i18n/ru.js';
import { en } from './i18n/en.js';
import { LANGUAGES, localeOf, dirOf, resolveLanguage } from './i18n/languages.js';

// Dictionaries loaded so far. English is the fallback and Russian the oldest
// default, so both are bundled; the others come in on first use.
export const translations = { ru, en };
const loading = new Map();

function browserLanguages() {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
}

export function currentLang() {
  return resolveLanguage(store.settings.language, browserLanguages());
}

export function isLanguageLoaded(code) {
  return Boolean(translations[code]);
}

// Loads a language's dictionary once. Resolves true when it is there; a
// language that fails to load keeps showing English.
export function ensureLanguage(code) {
  if (isLanguageLoaded(code)) return Promise.resolve(true);
  const info = LANGUAGES.find(l => l.code === code);
  if (!info || !info.load) return Promise.resolve(false);
  if (!loading.has(code)) {
    loading.set(code, info.load()
      .then(mod => { translations[code] = mod[code]; return true; })
      .catch(e => { console.error(`Language ${code} could not be loaded`, e); loading.delete(code); return false; }));
  }
  return loading.get(code);
}

// Calls `redraw` once the current language is loaded, when it is not yet.
// Returns true when it already is, so the caller can draw right away.
export function whenLanguageLoaded(redraw) {
  const code = currentLang();
  if (isLanguageLoaded(code)) return true;
  ensureLanguage(code).then(ok => { if (ok && currentLang() === code) redraw(); });
  return false;
}

export function t(key, params = null) {
  const dict = translations[currentLang()] || en;
  let s = dict[key] ?? en[key] ?? key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
  }
  return s;
}

// CLDR plural categories as key suffixes. "other" is written as -many: the
// keys were Russian and English first (one/few/many), and English "other"
// and Russian "many" read the same.
const PLURAL_SUFFIX = { zero: 'zero', one: 'one', two: 'two', few: 'few', many: 'many', other: 'many' };

const pluralRules = new Map();
function rulesFor(locale) {
  if (!pluralRules.has(locale)) pluralRules.set(locale, new Intl.PluralRules(locale));
  return pluralRules.get(locale);
}

// The key suffix for `n` in a language: 'one', 'few', 'many'...
export function pluralSuffix(code, n) {
  return PLURAL_SUFFIX[rulesFor(localeOf(code)).select(n)] || 'many';
}

// `prefix` is a key prefix: prefix-one, prefix-few, prefix-many and, where a
// language needs them, prefix-zero and prefix-two. A form the dictionary
// does not have falls back to prefix-many.
export function tn(prefix, n, params = {}) {
  const code = currentLang();
  const dict = translations[code] || en;
  const key = `${prefix}-${pluralSuffix(code, n)}`;
  return t(key in dict ? key : `${prefix}-many`, { n, ...params });
}

export function translatePage(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  const code = currentLang();
  document.documentElement.lang = code;
  document.documentElement.dir = dirOf(code);
}
