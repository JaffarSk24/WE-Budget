// Notifications of the operating system while the desktop app is open: at
// the reminder time, the payments of today (and overdue ones) that are still
// not marked; in the morning, if switched on, what today holds. The
// reminder in Google Calendar works without the app; this one is the
// backup on the computer.

import { store } from './store.js';
import { t } from './i18n.js';
import { lang } from './ui.js';
import { formatMoney } from './money.js';
import { todayKey } from './dates.js';
import { live } from './model.js';

const MORNING = '08:00';
const LATE_LIMIT_MIN = 60; // a computer asleep at the time gets no late notification after this
const FIRED_KEY = 'we-budget-notified';

function readFired() {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}'); } catch (e) { return {}; }
}

function writeFired(fired) {
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(fired)); } catch (e) { /* optional */ }
}

function minutesOf(time) {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function open(entry) {
  return (entry.status === 'planned' || entry.status === 'reserved') && entry.amount !== 0;
}

function describe(entries) {
  const currency = store.settings.currency || 'EUR';
  const shown = entries.slice(0, 4).map(e => `${e.title || t('untitled')} ${formatMoney(e.amount, { currency, lang: lang() })}`);
  if (entries.length > shown.length) shown.push(t('notify-more', { n: entries.length - shown.length }));
  return shown.join(', ');
}

function show(title, body, onClick) {
  if (typeof Notification === 'undefined') return;
  try {
    const n = new Notification(title, { body, silent: false });
    n.onclick = () => {
      try { window.focus(); } catch (e) { /* ignore */ }
      if (onClick) onClick();
    };
  } catch (e) {
    console.error('[notify]', e);
  }
}

// Called every half minute; fires each kind of notification at most once a
// day, within an hour after its time.
export function checkNotifications(now = new Date()) {
  const s = store.settings;
  const today = todayKey();
  const minute = now.getHours() * 60 + now.getMinutes();
  const fired = readFired();
  const due = (kind, time) => {
    const at = minutesOf(time);
    return at !== null && minute >= at && minute - at < LATE_LIMIT_MIN && fired[kind] !== today;
  };

  if (s.macNotifications && due('evening', s.reminderTime || '23:00')) {
    fired.evening = today;
    const unmarked = live(store.data.entries)
      .filter(e => open(e) && e.date <= today && e.date >= (s.trackingStart || '0000-01-01'))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (unmarked.length) {
      show(t('notify-evening-title', { n: unmarked.length }), describe(unmarked), () => { window.location.hash = '#month'; });
    }
  }

  if (s.morningDigest && due('morning', MORNING)) {
    fired.morning = today;
    const todays = live(store.data.entries).filter(e => open(e) && e.date === today);
    if (todays.length) {
      show(t('notify-morning-title', { n: todays.length }), describe(todays), () => { window.location.hash = '#overview'; });
    }
  }
  writeFired(fired);
}

export function initNotifications() {
  // Only the desktop app: the phone gets its reminders from Google Calendar.
  if (!window.weApp || typeof Notification === 'undefined') return;
  setInterval(() => checkNotifications(), 30 * 1000);
  checkNotifications();
}
