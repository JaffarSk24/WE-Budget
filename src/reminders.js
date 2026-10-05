// Reminders in Google Calendar. The app keeps a calendar of its own,
// "WE Budget", with one event per day that still has unmarked payments, at
// the reminder time. Google sends the reminder, so it arrives even when
// every computer is off and the phone app is closed.
//
// Every device with reminders on computes the same plan from the same
// budget and brings the calendar in line with it: create the missing
// events, rewrite the changed ones, delete the ones whose day is all
// marked, and drop duplicates two devices may have created at once. It
// does not matter which device made the change.
//
// Pure parts (the plan, the event, the reconciliation) take the calendar
// transport and the texts as arguments, so tests run them without Google.

import { live } from './model.js';
import { addDays } from './dates.js';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const REMINDER_DAYS = 60;
export const APP_URL = 'https://jaffarsk24.github.io/WE-Budget/app/';

// A payment that still waits to be marked: planned or set aside, with an
// amount (zero rows only remind that a payment exists).
function needsMark(entry) {
  return (entry.status === 'planned' || entry.status === 'reserved') && entry.amount !== 0;
}

// Days from today on (REMINDER_DAYS of them) with unmarked payments, each
// with its entries in the order of the month view.
export function reminderPlan(data, today, { days = REMINDER_DAYS } = {}) {
  const last = addDays(today, days - 1);
  const byDay = new Map();
  live(data.entries)
    .filter(e => e.date >= today && e.date <= last && needsMark(e))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''))
    .forEach(e => {
      if (!byDay.has(e.date)) byDay.set(e.date, []);
      byDay.get(e.date).push(e);
    });
  const overdue = live(data.entries).filter(e => e.date < today && needsMark(e)
    && e.date >= ((data.settings && data.settings.trackingStart) || '0000-01-01')).length;
  return [...byDay.entries()].map(([day, entries]) => ({ day, entries, overdue: day === today ? overdue : 0 }));
}

// Small, stable string hash: tells whether an event has to be rewritten.
function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// End of the event a quarter of an hour after its start, past midnight if
// need be.
function endOf(day, time) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const end = new Date(y, m - 1, d, hh, mm + 15);
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
}

// The event for one day of the plan. `texts` turns entries into words:
// { summary(count, overdue), line(entry), open } (see reminderTexts).
export function reminderEvent(item, { time, timeZone, texts, appUrl = APP_URL }) {
  const summary = texts.summary(item.entries.length, item.overdue);
  const description = [
    ...item.entries.map(e => texts.line(e)),
    '',
    `${texts.open}: ${appUrl}#day=${item.day}`
  ].join('\n');
  const hash = hashText([summary, description, time, timeZone].join('|'));
  return {
    summary,
    description,
    start: { dateTime: `${item.day}T${time}:00`, timeZone },
    end: { dateTime: endOf(item.day, time), timeZone },
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { weBudget: '1', weBudgetDay: item.day, weBudgetHash: hash } }
  };
}

// Brings the calendar in line with the plan. `cal` is the transport:
// list(calendarId, timeMin) -> events; insert/patch/remove. Returns the
// counts of what changed.
export async function reconcileCalendar({ cal, calendarId, plan, today, time, timeZone, texts, appUrl = APP_URL }) {
  const [y, m, d] = today.split('-').map(Number);
  const existing = await cal.list(calendarId, new Date(y, m - 1, d).toISOString());
  const byDay = new Map();
  existing.forEach(ev => {
    const day = ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.weBudgetDay;
    if (!day) return;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(ev);
  });
  const done = { created: 0, updated: 0, deleted: 0 };
  for (const item of plan) {
    const body = reminderEvent(item, { time, timeZone, texts, appUrl });
    const [first, ...extra] = byDay.get(item.day) || [];
    if (!first) {
      await cal.insert(calendarId, body);
      done.created++;
    } else if (first.extendedProperties.private.weBudgetHash !== body.extendedProperties.private.weBudgetHash) {
      await cal.patch(calendarId, first.id, body);
      done.updated++;
    }
    for (const ev of extra) {
      await cal.remove(calendarId, ev.id);
      done.deleted++;
    }
    byDay.delete(item.day);
  }
  for (const events of byDay.values()) {
    for (const ev of events) {
      await cal.remove(calendarId, ev.id);
      done.deleted++;
    }
  }
  return done;
}

// Calendar transport over a generic request(method, path, { query, body })
// that returns { ok, status, json } (the desktop and web bridges both
// offer one).
export function calendarTransport(request) {
  const call = async (method, path, options) => {
    const res = await request(method, path, options || {});
    if (!res || !res.ok) {
      const err = new Error((res && res.error) || `calendar ${res && res.status}`);
      err.status = res && res.status;
      err.scope = Boolean(res && res.scopeMissing);
      throw err;
    }
    return res.json;
  };
  const enc = encodeURIComponent;
  return {
    async list(calendarId, timeMin) {
      const items = [];
      let pageToken = null;
      do {
        const query = { privateExtendedProperty: 'weBudget=1', timeMin, singleEvents: 'true', maxResults: '250' };
        if (pageToken) query.pageToken = pageToken;
        const page = await call('GET', `/calendars/${enc(calendarId)}/events`, { query });
        items.push(...(page.items || []));
        pageToken = page.nextPageToken || null;
      } while (pageToken);
      return items;
    },
    insert: (calendarId, body) => call('POST', `/calendars/${enc(calendarId)}/events`, { body }),
    patch: (calendarId, id, body) => call('PATCH', `/calendars/${enc(calendarId)}/events/${enc(id)}`, { body }),
    remove: (calendarId, id) => call('DELETE', `/calendars/${enc(calendarId)}/events/${enc(id)}`),
    createCalendar: (summary, timeZone) => call('POST', '/calendars', { body: { summary, timeZone } }),
    deleteCalendar: (calendarId) => call('DELETE', `/calendars/${enc(calendarId)}`)
  };
}
