// Calendar dates are plain local day keys "YYYY-MM-DD" with no time zone.
// Timestamps (createdAt, updatedAt, doneAt) are ISO strings in UTC and are
// converted to local time only for display. Never build a day key from
// toISOString(): between 22:00 and midnight in Central Europe that is already
// the next day in UTC.

import { localeOf } from './i18n/languages.js';

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey() {
  return dayKey(new Date());
}

export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDayKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = parseDayKey(value);
  return dayKey(d) === value;
}

export function monthOf(key) {
  return key.slice(0, 7);
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function addDays(key, n) {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

// Whole days from one day key to another (negative when `to` is earlier).
// Counted in UTC so a daylight saving change does not lose an hour.
export function daysBetween(from, to) {
  const utc = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(to) - utc(from)) / 86400000);
}

// Month arithmetic on "YYYY-MM".
export function addMonthsToMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

// Day `day` of a month, clamped to its length (31 -> last day of February).
export function dayInMonth(month, day) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

export function firstDayOfMonth(month) {
  return `${month}-01`;
}

export function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(daysInMonth(y, m))}`;
}

export function monthsBetween(fromMonth, toMonth) {
  const [y1, m1] = fromMonth.split('-').map(Number);
  const [y2, m2] = toMonth.split('-').map(Number);
  return (y2 * 12 + m2) - (y1 * 12 + m1);
}

// 0 = Monday ... 6 = Sunday.
export function weekdayIndex(key) {
  return (parseDayKey(key).getDay() + 6) % 7;
}

// `lang` is a language code from i18n/languages.js; its Intl locale formats.
const locale = localeOf;

export function formatDay(key, lang = 'ru') {
  return parseDayKey(key).toLocaleDateString(locale(lang), { day: '2-digit', month: '2-digit' });
}

export function formatDayLong(key, lang = 'ru') {
  const s = parseDayKey(key).toLocaleDateString(locale(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Russian adds "г." after the year; it doubles up with a sentence's own period.
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace(/\s*г\.$/, '');
}

// "1 ноября 2026" / "1 November 2026", for use inside a sentence.
export function formatDate(key, lang = 'ru') {
  return parseDayKey(key).toLocaleDateString(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
}

// "Март 2026" / "Marzo de 2026": a month standing alone, as a heading, a
// chart label or a table cell, with a capital first letter.
export function formatMonth(month, lang = 'ru') {
  const s = formatMonthInText(month, lang);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "март 2026" / "marzo de 2026" / "März 2026": a month inside a sentence,
// in the case the language itself writes it.
export function formatMonthInText(month, lang = 'ru') {
  return parseDayKey(firstDayOfMonth(month)).toLocaleDateString(locale(lang), { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
}

// "16.10.2026" / "16/10/2026": a day with its year in short numeric form;
// `shortYear` writes "16.10.26".
export function formatDayYear(key, lang = 'ru', { shortYear = false } = {}) {
  return parseDayKey(key).toLocaleDateString(locale(lang), { day: '2-digit', month: '2-digit', year: shortYear ? '2-digit' : 'numeric' });
}

// "Oct 26" / "окт. 26 г.": a short month label for chart axes.
export function formatMonthShort(month, lang = 'ru') {
  const s = parseDayKey(firstDayOfMonth(month)).toLocaleDateString(locale(lang), { month: 'short', year: '2-digit' });
  // British English abbreviates September as "Sept"; the axes have always
  // used three letters for every month.
  return lang === 'en' ? s.replace(/^Sept\b/, 'Sep') : s;
}

// "Tue" / "вт": the short weekday of a day.
export function formatWeekdayShort(key, lang = 'ru') {
  return parseDayKey(key).toLocaleDateString(locale(lang), { weekday: 'short' });
}

export function formatTimestamp(iso, lang = 'ru') {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale(lang), {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// "14:05": the local time of a timestamp.
export function formatTime(iso, lang = 'ru') {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' });
}
