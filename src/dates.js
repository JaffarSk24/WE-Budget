// Calendar dates are plain local day keys "YYYY-MM-DD" with no time zone.
// Timestamps (createdAt, updatedAt, doneAt) are ISO strings in UTC and are
// converted to local time only for display. Never build a day key from
// toISOString(): between 22:00 and midnight in Central Europe that is already
// the next day in UTC.

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

function locale(lang) {
  return lang === 'ru' ? 'ru-RU' : 'en-GB';
}

export function formatDay(key, lang = 'ru') {
  return parseDayKey(key).toLocaleDateString(locale(lang), { day: '2-digit', month: '2-digit' });
}

export function formatDayLong(key, lang = 'ru') {
  const s = parseDayKey(key).toLocaleDateString(locale(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Russian adds "г." after the year; it doubles up with a sentence's own period.
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace(/\s*г\.$/, '');
}

export function formatMonth(month, lang = 'ru') {
  const s = parseDayKey(firstDayOfMonth(month)).toLocaleDateString(locale(lang), { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/\s*г\.$/, '');
}

export function formatTimestamp(iso, lang = 'ru') {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale(lang), {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}
