// Interface texts. Keys are looked up in the current language, then in
// English, then the key itself is shown (a missing key is visible, not
// silent). {name} placeholders are filled from params.

import { store } from './store.js';
import { ru } from './i18n/ru.js';
import { en } from './i18n/en.js';

export const translations = { ru, en };

export function currentLang() {
  return store.settings.language === 'en' ? 'en' : 'ru';
}

export function t(key, params = null) {
  const lang = currentLang();
  let s = translations[lang][key] ?? translations.en[key] ?? key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
  }
  return s;
}

// Russian has three plural forms, English two. `forms` is a key prefix:
// key-one, key-few, key-many.
export function tn(prefix, n, params = {}) {
  const lang = currentLang();
  let form = 'many';
  if (lang === 'ru') {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) form = 'one';
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) form = 'few';
  } else if (n === 1) {
    form = 'one';
  }
  return t(`${prefix}-${form}`, { n, ...params });
}

export function translatePage(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.documentElement.lang = currentLang();
}
