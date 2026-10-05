// Keeps the "WE Budget" calendar in Google Calendar in line with the
// budget on this device: after changes (with a pause), after each sync and
// at start. Works the same on the desktop and in the phone app; only the
// transport behind sync.bridge.calendar differs.

import { store } from './store.js';
import { t } from './i18n.js';
import { sync } from './cloud.js';
import { lang } from './ui.js';
import { formatMoney } from './money.js';
import { todayKey } from './dates.js';
import { CALENDAR_SCOPE, reminderPlan, reconcileCalendar, calendarTransport } from './reminders.js';

const CREATED_KEY = 'we-budget-created-calendars';
const DEBOUNCE_MS = 20 * 1000;
const HEAL_MS = 6 * 60 * 60 * 1000;

const listeners = [];
export const reminderState = { status: 'off', at: null, error: null };

function setState(patch) {
  Object.assign(reminderState, patch);
  listeners.forEach(fn => { try { fn(reminderState); } catch (e) { console.error(e); } });
}

export function onReminderChange(fn) {
  listeners.push(fn);
}

function bridge() {
  return sync.bridge && typeof sync.bridge.calendar === 'function' ? sync.bridge : null;
}

function readCreated() {
  try { return JSON.parse(localStorage.getItem(CREATED_KEY) || '[]'); } catch (e) { return []; }
}

function writeCreated(list) {
  try { localStorage.setItem(CREATED_KEY, JSON.stringify(list)); } catch (e) { /* optional */ }
}

function timeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
}

function texts() {
  const accountName = (id) => {
    const acc = store.find('accounts', id);
    return acc ? acc.name : '';
  };
  return {
    summary: (n, overdue) => overdue
      ? t('reminder-summary-overdue', { n, overdue })
      : t('reminder-summary', { n }),
    line: (e) => {
      const amount = formatMoney(e.amount, { currency: store.settings.currency || 'EUR', lang: lang() });
      const where = accountName(e.accountId);
      return `• ${e.title || t('untitled')}: ${amount}${where ? `, ${where}` : ''}`;
    },
    open: t('reminder-open')
  };
}

// Whether Google already granted the calendar permission to this sign-in.
export async function hasCalendarAccess() {
  const b = bridge();
  if (!b) return false;
  const status = await b.status();
  return Boolean(status && status.loggedIn && (status.scopes || []).includes(CALENDAR_SCOPE));
}

// Asks Google for the calendar permission (a new consent page). In the
// phone app this leaves the page and comes back signed in.
export async function requestCalendarAccess() {
  const b = bridge();
  if (!b) return false;
  setState({ status: 'asking' });
  const result = await b.login(lang(), { calendar: true });
  if (!result || !result.ok) {
    setState({ status: 'needs-access', error: result && result.error });
    return false;
  }
  await run({ force: true });
  return true;
}

let lastKey = null;
let lastRun = 0;
let running = null;
let again = false;

async function ensureCalendar(cal) {
  let id = store.settings.reminderCalendarId;
  if (!id) {
    const created = await cal.createCalendar('WE Budget', timeZone());
    id = created.id;
    writeCreated([...readCreated(), id]);
    store.updateSettings({ reminderCalendarId: id });
  }
  // Two devices may each create a calendar before they sync; the budget
  // keeps one of them, and the device that made the other removes it.
  const mine = readCreated();
  const orphans = mine.filter(c => c !== id);
  for (const orphan of orphans) {
    try { await cal.deleteCalendar(orphan); } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
  }
  if (orphans.length) writeCreated(mine.filter(c => c === id));
  return id;
}

async function runOnce({ force = false } = {}) {
  const b = bridge();
  if (!b) return setState({ status: 'unavailable' });
  if (!store.settings.calendarReminders) return setState({ status: 'off', error: null });
  if (!sync.loggedIn) return setState({ status: 'signed-out' });

  const today = todayKey();
  const plan = reminderPlan(store.data, today);
  const time = store.settings.reminderTime || '23:00';
  const key = JSON.stringify([store.settings.reminderCalendarId || null, time, lang(), today,
    plan.map(p => [p.day, p.overdue, p.entries.map(e => [e.id, e.title, e.amount, e.accountId])])]);
  if (!force && key === lastKey && Date.now() - lastRun < HEAL_MS) return;
  if (!(await hasCalendarAccess())) return setState({ status: 'needs-access' });

  const cal = calendarTransport((method, path, { query, body } = {}) => b.calendar(method, path, query || null, body || null));
  setState({ status: 'working' });
  try {
    let calendarId = await ensureCalendar(cal);
    let result;
    try {
      result = await reconcileCalendar({ cal, calendarId, plan, today, time, timeZone: timeZone(), texts: texts() });
    } catch (e) {
      // The calendar was deleted in Google Calendar: make a new one.
      if (e.status !== 404 && e.status !== 410) throw e;
      store.updateSettings({ reminderCalendarId: null });
      calendarId = await ensureCalendar(cal);
      result = await reconcileCalendar({ cal, calendarId, plan, today, time, timeZone: timeZone(), texts: texts() });
    }
    lastKey = key;
    lastRun = Date.now();
    setState({ status: 'ok', at: new Date().toISOString(), error: null, result });
  } catch (e) {
    setState({ status: e.scope ? 'needs-access' : 'error', error: e.message });
  }
}

export function run(options) {
  if (running) {
    again = true;
    return running;
  }
  running = runOnce(options).finally(() => {
    running = null;
    if (again) {
      again = false;
      run();
    }
  });
  return running;
}

// Turning reminders off removes the app's calendar with all its events.
export async function turnOffReminders() {
  store.updateSettings({ calendarReminders: false });
  const id = store.settings.reminderCalendarId;
  const b = bridge();
  if (id && b && sync.loggedIn) {
    const cal = calendarTransport((method, path, { query, body } = {}) => b.calendar(method, path, query || null, body || null));
    try { await cal.deleteCalendar(id); } catch (e) { /* already gone, or offline: harmless */ }
  }
  store.updateSettings({ reminderCalendarId: null });
  writeCreated([]);
  setState({ status: 'off', error: null });
}

let timer = null;
export function initReminders() {
  if (!bridge()) return;
  store.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => run(), DEBOUNCE_MS);
  });
  sync.onChange((st) => {
    if (st.status === 'idle') run();
  });
  setInterval(() => run(), 60 * 60 * 1000);
}

export function reminderStatusText() {
  switch (reminderState.status) {
    case 'ok': return t('reminder-ok', { time: new Date(reminderState.at).toLocaleTimeString(lang() === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' }) });
    case 'working': return t('reminder-working');
    case 'needs-access': return t('reminder-needs-access');
    case 'signed-out': return t('reminder-signed-out');
    case 'asking': return t('sync-waiting-browser');
    case 'error': return t('reminder-error');
    default: return '';
  }
}

