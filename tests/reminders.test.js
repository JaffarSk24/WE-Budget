import { describe, it, expect } from 'vitest';
import { reminderPlan, reminderEvent, reconcileCalendar, calendarTransport } from '../src/reminders.js';
import { emptyData, makeAccount, makeEntry } from '../src/model.js';

const texts = {
  summary: (n, overdue) => `unmarked ${n}${overdue ? ` +${overdue}` : ''}`,
  line: (e) => `${e.title} ${e.amount}`,
  open: 'Open'
};

function budget() {
  const data = emptyData();
  data.settings.trackingStart = '2026-10-01';
  const acc = makeAccount({ name: 'Main' });
  data.accounts.push(acc);
  const add = (date, title, amount, status = 'planned') => {
    const e = makeEntry({ date, title, amount, accountId: acc.id, status });
    data.entries.push(e);
    return e;
  };
  return { data, add };
}

// In-memory calendar with the transport's shape.
function fakeCalendar() {
  let seq = 0;
  const events = new Map();
  const log = [];
  return {
    events,
    log,
    async list() { return [...events.values()].map(e => structuredClone(e)); },
    async insert(_cal, body) { const id = `ev${++seq}`; events.set(id, { id, ...structuredClone(body) }); log.push(['insert', body.extendedProperties.private.weBudgetDay]); return { id }; },
    async patch(_cal, id, body) { events.set(id, { id, ...structuredClone(body) }); log.push(['patch', body.extendedProperties.private.weBudgetDay]); return { id }; },
    async remove(_cal, id) { log.push(['remove', events.get(id).extendedProperties.private.weBudgetDay]); events.delete(id); return {}; }
  };
}

const run = (cal, data, today = '2026-10-10') => reconcileCalendar({
  cal, calendarId: 'c1', plan: reminderPlan(data, today), today, time: '23:00', timeZone: 'Europe/Bratislava', texts
});

describe('reminder plan', () => {
  it('lists days from today on with payments still to be marked', () => {
    const { data, add } = budget();
    add('2026-10-09', 'Yesterday', 1000);
    add('2026-10-10', 'Rent', 70000);
    add('2026-10-10', 'Set aside', 4000, 'reserved');
    add('2026-10-10', 'Paid', 2500, 'done');
    add('2026-10-10', 'Skipped', 2500, 'cancelled');
    add('2026-10-10', 'Zero reminder row', 0);
    add('2026-10-12', 'Phone', 2500);
    add('2026-12-31', 'Too far', 2500);
    const plan = reminderPlan(data, '2026-10-10');
    expect(plan.map(p => [p.day, p.entries.map(e => e.title), p.overdue])).toEqual([
      ['2026-10-10', ['Rent', 'Set aside'], 1],
      ['2026-10-12', ['Phone'], 0]
    ]);
  });
});

describe('reminder event', () => {
  it('starts at the reminder time and ends a quarter of an hour later, past midnight if need be', () => {
    const item = { day: '2026-10-10', entries: [{ title: 'Rent', amount: 70000 }], overdue: 0 };
    const late = reminderEvent(item, { time: '23:50', timeZone: 'Europe/Bratislava', texts });
    expect(late.start).toEqual({ dateTime: '2026-10-10T23:50:00', timeZone: 'Europe/Bratislava' });
    expect(late.end).toEqual({ dateTime: '2026-10-11T00:05:00', timeZone: 'Europe/Bratislava' });
    expect(late.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
    expect(late.description).toContain('#day=2026-10-10');
    const other = reminderEvent(item, { time: '22:00', timeZone: 'Europe/Bratislava', texts });
    expect(other.extendedProperties.private.weBudgetHash).not.toBe(late.extendedProperties.private.weBudgetHash);
  });
});

describe('calendar reconciliation', () => {
  it('creates, rewrites and deletes events as the plan changes, and drops duplicates', async () => {
    const { data, add } = budget();
    const rent = add('2026-10-10', 'Rent', 70000);
    add('2026-10-12', 'Phone', 2500);
    const cal = fakeCalendar();

    expect(await run(cal, data)).toEqual({ created: 2, updated: 0, deleted: 0 });
    expect(await run(cal, data)).toEqual({ created: 0, updated: 0, deleted: 0 });

    add('2026-10-10', 'Doctor', 4000);
    expect(await run(cal, data)).toEqual({ created: 0, updated: 1, deleted: 0 });

    // another device created the same day at the same moment
    const [someId] = [...cal.events.keys()];
    const copy = structuredClone(cal.events.get(someId));
    cal.events.set('dup', { ...copy, id: 'dup' });
    expect(await run(cal, data)).toEqual({ created: 0, updated: 0, deleted: 1 });

    // everything on the 12th marked: its event goes
    data.entries.filter(e => e.date === '2026-10-12').forEach(e => { e.status = 'done'; });
    expect(await run(cal, data)).toEqual({ created: 0, updated: 0, deleted: 1 });
    rent.status = 'done';
    const left = await run(cal, data);
    expect(left).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect([...cal.events.values()].map(e => e.extendedProperties.private.weBudgetDay)).toEqual(['2026-10-10']);
  });
});

describe('calendar transport', () => {
  it('follows result pages and reports failures', async () => {
    const calls = [];
    const request = async (method, path, { query } = {}) => {
      calls.push([method, path, query && query.pageToken]);
      if (method === 'GET') {
        return query.pageToken
          ? { ok: true, json: { items: [{ id: 'b' }] } }
          : { ok: true, json: { items: [{ id: 'a' }], nextPageToken: 'p2' } };
      }
      return { ok: false, status: 403, error: 'insufficient', scopeMissing: true };
    };
    const cal = calendarTransport(request);
    expect((await cal.list('cal@group', '2026-10-10T00:00:00.000Z')).map(e => e.id)).toEqual(['a', 'b']);
    expect(calls[0][1]).toBe('/calendars/cal%40group/events');
    await expect(cal.insert('cal@group', {})).rejects.toMatchObject({ status: 403, scope: true });
  });
});
