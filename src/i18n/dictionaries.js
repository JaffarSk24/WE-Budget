// The dictionaries loaded so far, kept apart from the store: the model and
// the demo name things in a given language (a new budget's categories, the
// demo household) without depending on the current settings. English is the
// fallback and Russian the oldest default, so both are bundled; i18n.js
// loads the others on first use.

import { ru } from './ru.js';
import { en } from './en.js';

export const translations = { ru, en };

// Fills {name} placeholders from params; unknown ones stay visible.
export function fillText(s, params = null) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
}

// A t() for one language: its text, else English, else the key. A language
// that is not loaded yet reads English.
export function textsIn(code) {
  const dict = translations[code] || en;
  return (key, params = null) => fillText(dict[key] ?? en[key] ?? key, params);
}
