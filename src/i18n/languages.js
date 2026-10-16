// The interface languages. One line per language; this file is the only
// place that knows which languages exist. It is plain data plus small pure
// helpers, so dates.js and money.js can read locales from it without
// pulling in the store.
//
//   code     key in settings.language and the name of the locale file
//   name     native name, shown in the language picker
//   english  English name, for docs and tests
//   dir      'rtl' for scripts written right to left
//   locale   BCP 47 locale for Intl (dates, numbers, money)
//   decimal  the decimal separator people type in amounts
//   ready    shown in the picker only when the translation is complete
//   load     the locale file, loaded on first use as its own chunk.
//            English and Russian have none: i18n.js bundles them, so the
//            fallback and the oldest default are there from the start
//
// Arabic and Urdu use Latin digits (-u-nu-latn) in amounts and dates: sums
// then read the same as on bank statements and in the other languages.
export const LANGUAGES = [
  { code: 'en', name: 'English', english: 'English', dir: 'ltr', locale: 'en-GB', decimal: '.', ready: true },
  { code: 'ru', name: 'Русский', english: 'Russian', dir: 'ltr', locale: 'ru-RU', decimal: ',', ready: true },
  { code: 'sk', name: 'Slovenčina', english: 'Slovak', dir: 'ltr', locale: 'sk-SK', decimal: ',', ready: false, load: () => import('./sk.js') },
  { code: 'cs', name: 'Čeština', english: 'Czech', dir: 'ltr', locale: 'cs-CZ', decimal: ',', ready: false, load: () => import('./cs.js') },
  { code: 'uk', name: 'Українська', english: 'Ukrainian', dir: 'ltr', locale: 'uk-UA', decimal: ',', ready: true, load: () => import('./uk.js') },
  { code: 'es', name: 'Español', english: 'Spanish', dir: 'ltr', locale: 'es-ES', decimal: ',', ready: false, load: () => import('./es.js') },
  { code: 'fr', name: 'Français', english: 'French', dir: 'ltr', locale: 'fr-FR', decimal: ',', ready: false, load: () => import('./fr.js') },
  { code: 'pt', name: 'Português', english: 'Portuguese (Brazil)', dir: 'ltr', locale: 'pt-BR', decimal: ',', ready: false, load: () => import('./pt.js') },
  { code: 'zh', name: '中文 简体', english: 'Chinese (Simplified)', dir: 'ltr', locale: 'zh-CN', decimal: '.', ready: false, load: () => import('./zh.js') },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', dir: 'ltr', locale: 'hi-IN', decimal: '.', ready: false, load: () => import('./hi.js') },
  { code: 'bn', name: 'বাংলা', english: 'Bengali', dir: 'ltr', locale: 'bn-BD', decimal: '.', ready: false, load: () => import('./bn.js') },
  { code: 'ar', name: 'العربية', english: 'Arabic', dir: 'rtl', locale: 'ar-u-nu-latn', decimal: '.', ready: false, load: () => import('./ar.js') },
  { code: 'ur', name: 'اردو', english: 'Urdu', dir: 'rtl', locale: 'ur-PK-u-nu-latn', decimal: '.', ready: false, load: () => import('./ur.js') }
];

export const DEFAULT_LANGUAGE = 'en';

const BY_CODE = new Map(LANGUAGES.map(l => [l.code, l]));

export function isRegistered(code) {
  return BY_CODE.has(code);
}

// Unknown codes get English, so a helper never throws on old or foreign data.
export function languageInfo(code) {
  return BY_CODE.get(code) || BY_CODE.get(DEFAULT_LANGUAGE);
}

export const localeOf = (code) => languageInfo(code).locale;
export const decimalOf = (code) => languageInfo(code).decimal;
export const dirOf = (code) => languageInfo(code).dir;

export function readyLanguages() {
  return LANGUAGES.filter(l => l.ready);
}

// Options for a language <select>: the ready languages by native name. A
// saved language that is not ready yet stays in the list, so the picker
// still shows what is selected.
export function languageOptions(current = null) {
  return LANGUAGES
    .filter(l => l.ready || l.code === current)
    .map(l => ({ value: l.code, label: l.name }));
}

// The first browser language ("sk-SK", "pt-PT", "zh-Hans-CN") whose primary
// subtag is a registered, ready language; null when none is.
export function matchBrowserLanguage(list = []) {
  for (const tag of list || []) {
    const code = String(tag || '').toLowerCase().split(/[-_]/)[0];
    const info = BY_CODE.get(code);
    if (info && info.ready) return code;
  }
  return null;
}

// The language the interface uses: the saved one when it is registered,
// otherwise (first run, nothing saved yet) the browser's, otherwise English.
export function resolveLanguage(saved, browserLanguages = []) {
  if (isRegistered(saved)) return saved;
  return matchBrowserLanguage(browserLanguages) || DEFAULT_LANGUAGE;
}
