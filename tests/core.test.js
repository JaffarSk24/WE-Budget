import { describe, it, expect } from 'vitest';
import { parseMoney, formatMoney } from '../src/money.js';
import { addDays, addMonthsToMonth, dayInMonth, isDayKey, dayKey } from '../src/dates.js';
import { occurrences, pendingGeneration } from '../src/schedule.js';
import { makeAccount, makeEntry, makeTemplate, emptyData } from '../src/model.js';
import {
  accountSummaries, grandTotals, monthRows, monthSummary, forecast, overdueEntries
} from '../src/ledger.js';
import { suggestAllocation, buildAllocation, defaultAllocationEnd } from '../src/allocation.js';
import { buildReconciliation } from '../src/reconcile.js';

describe('money', () => {
  it('parses the usual ways people type amounts', () => {
    expect(parseMoney('2 450,50')).toBe(245050);
    expect(parseMoney('2450.5')).toBe(245050);
    expect(parseMoney('47,35€')).toBe(4735);
    expect(parseMoney('2,450')).toBe(245000);
    expect(parseMoney('2.450.000')).toBe(245000000);
    expect(parseMoney('2.450,25')).toBe(245025);
    expect(parseMoney('2,450.25')).toBe(245025);
    expect(parseMoney('-12')).toBe(-1200);
    expect(parseMoney('0,01')).toBe(1);
    expect(parseMoney('abc')).toBe(null);
    expect(parseMoney('')).toBe(null);
    expect(parseMoney('1,234,5')).toBe(null);
  });

  it('formats with the symbol attached and no float drift', () => {
    expect(formatMoney(245050, { lang: 'en' })).toBe('2,450.50€');
    expect(formatMoney(-4735, { lang: 'en' })).toBe('-47.35€');
    expect(formatMoney(500, { lang: 'en', signed: true })).toBe('+5.00€');
    expect(formatMoney(10 + 20, { lang: 'en' })).toBe('0.30€');
  });
});

describe('dates', () => {
  it('works with local day keys', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonthsToMonth('2026-11', 3)).toBe('2027-02');
    expect(addMonthsToMonth('2026-01', -1)).toBe('2025-12');
    expect(dayInMonth('2027-02', 31)).toBe('2027-02-28');
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-02-28')).toBe(true);
  });

  it('builds the day key from local time, not UTC', () => {
    // 23:30 local time must stay on the same day whatever the UTC date is.
    const late = new Date(2026, 9, 5, 23, 30);
    expect(dayKey(late)).toBe('2026-10-05');
  });
});

describe('schedule', () => {
  it('monthly clamps day 31 to the end of short months', () => {
    expect(occurrences({ freq: 'monthly', day: 31, startDate: '2026-01-01' }, '2026-01-01', '2026-03-31'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('every two months keeps the phase of the start month', () => {
    expect(occurrences({ freq: 'everyNMonths', interval: 2, day: 6, startDate: '2026-09-06' }, '2026-10-01', '2027-02-28'))
      .toEqual(['2026-11-06', '2027-01-06']);
  });

  it('weekly, yearly and once', () => {
    expect(occurrences({ freq: 'weekly', weekdays: [0], startDate: '2026-10-01' }, '2026-10-01', '2026-10-15'))
      .toEqual(['2026-10-05', '2026-10-12']);
    expect(occurrences({ freq: 'yearly', day: 15, startDate: '2025-03-15' }, '2026-01-01', '2027-12-31'))
      .toEqual(['2026-03-15', '2027-03-15']);
    expect(occurrences({ freq: 'once', startDate: '2026-10-20' }, '2026-10-01', '2026-10-31'))
      .toEqual(['2026-10-20']);
  });

  it('respects the end date', () => {
    expect(occurrences({ freq: 'monthly', day: 10, startDate: '2026-01-10', endDate: '2026-02-15' }, '2026-01-01', '2026-12-31'))
      .toEqual(['2026-01-10', '2026-02-10']);
  });

  it('never recreates an occurrence that was deleted or moved', () => {
    const data = emptyData();
    const t = makeTemplate({ title: 'Rent', amount: 95000, schedule: { freq: 'monthly', day: 1, startDate: '2026-10-01' } });
    data.templates.push(t);
    const first = pendingGeneration(data, '2026-10-01', '2026-12-31');
    expect(first.entries.map(e => e.date)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);

    data.entries.push(...first.entries);
    first.entries[1].deleted = true;
    first.entries[2].date = '2026-12-05';
    t.generatedThrough = null;
    expect(pendingGeneration(data, '2026-10-01', '2026-12-31').entries).toEqual([]);
  });
});

// A small household: main account, one envelope for bills, a savings pot.
function household() {
  const data = emptyData();
  data.settings.trackingStart = '2026-10-01';
  const main = makeAccount({ name: 'Main', openingBalance: 40000 });
  const bills = makeAccount({ name: 'Bills', parentId: main.id, openingBalance: 5000 });
  const savings = makeAccount({ name: 'Savings', kind: 'savings', openingBalance: 0 });
  data.accounts.push(main, bills, savings);
  const add = (f) => { const e = makeEntry(f); data.entries.push(e); return e; };
  return { data, main, bills, savings, add };
}

describe('ledger', () => {
  it('balance counts only what happened; reserved money is not free', () => {
    const { data, main, bills, add } = household();
    add({ date: '2026-10-02', type: 'income', amount: 100000, accountId: main.id, status: 'done' });
    add({ date: '2026-10-03', type: 'transfer', amount: 20000, accountId: main.id, toAccountId: bills.id, status: 'done' });
    add({ date: '2026-10-10', type: 'expense', amount: 16000, accountId: bills.id, status: 'reserved' });
    add({ date: '2026-10-12', type: 'expense', amount: 9999, accountId: main.id, status: 'planned' });

    const s = accountSummaries(data);
    expect(s.get(main.id).ownBalance).toBe(40000 + 100000 - 20000);
    expect(s.get(bills.id).ownBalance).toBe(25000);
    expect(s.get(bills.id).ownReserved).toBe(16000);
    expect(s.get(bills.id).ownFree).toBe(9000);
    expect(s.get(main.id).totalBalance).toBe(145000);

    const totals = grandTotals(data);
    expect(totals.balance).toBe(145000);
    expect(totals.free).toBe(129000);
  });

  it('history before trackingStart never touches account balances', () => {
    const { data, main, add } = household();
    add({ date: '2026-09-15', type: 'expense', amount: 50000, accountId: main.id, status: 'done' });
    expect(accountSummaries(data).get(main.id).ownBalance).toBe(40000);
  });

  it('running total of a month follows the plan and skips cancelled rows', () => {
    const { data, main, add } = household();
    add({ date: '2026-10-01', type: 'expense', amount: 95000, accountId: main.id, status: 'done' });
    add({ date: '2026-10-01', type: 'income', amount: 265000, accountId: main.id, status: 'done' });
    add({ date: '2026-10-05', type: 'expense', amount: 1000, accountId: main.id, status: 'cancelled' });
    add({ date: '2026-10-20', type: 'expense', amount: 5000, accountId: main.id, status: 'planned' });

    const rows = monthRows(data, '2026-10');
    // Opening balances 45000; income sorts first within the day.
    expect(rows.map(r => r.running)).toEqual([310000, 215000, 215000, 210000]);

    const sum = monthSummary(data, '2026-10');
    expect(sum.opening).toBe(45000);
    expect(sum.closing).toBe(210000);
    expect(sum.income).toBe(265000);
    expect(sum.expense).toBe(100000);

    // The next month starts where this one ended.
    expect(monthSummary(data, '2026-11').opening).toBe(210000);
  });

  it('transit and transfers stay out of income and expense', () => {
    const { data, main, bills, add } = household();
    add({ date: '2026-10-17', type: 'income', amount: 25000, accountId: main.id, status: 'done', isTransit: true });
    add({ date: '2026-10-17', type: 'expense', amount: 25000, accountId: main.id, status: 'done', isTransit: true });
    add({ date: '2026-10-18', type: 'transfer', amount: 1000, accountId: main.id, toAccountId: bills.id, status: 'done' });
    const sum = monthSummary(data, '2026-10');
    expect(sum.income).toBe(0);
    expect(sum.expense).toBe(0);
    expect(sum.closing).toBe(45000);
  });

  it('history months pool everything from the first record', () => {
    const { data, main, add } = household();
    add({ date: '2026-08-01', type: 'income', amount: 1000, accountId: main.id, status: 'done' });
    add({ date: '2026-09-01', type: 'expense', amount: 300, accountId: main.id, status: 'done' });
    expect(monthSummary(data, '2026-09').opening).toBe(1000);
    expect(monthSummary(data, '2026-09').closing).toBe(700);
    // From trackingStart on the real opening balances take over.
    expect(monthSummary(data, '2026-10').opening).toBe(45000);
  });

  it('overdue open entries stay visible until handled', () => {
    const { data, main, add } = household();
    const late = add({ date: '2026-10-03', type: 'expense', amount: 100, accountId: main.id, status: 'reserved' });
    add({ date: '2026-10-04', type: 'expense', amount: 100, accountId: main.id, status: 'done' });
    add({ date: '2026-09-04', type: 'expense', amount: 100, accountId: main.id, status: 'planned' });
    expect(overdueEntries(data, '2026-10-05').map(e => e.id)).toEqual([late.id]);
  });

  it('forecast finds the day money runs out', () => {
    const { data, main, add } = household();
    add({ date: '2026-10-03', type: 'expense', amount: 10000, accountId: main.id, status: 'planned' });
    add({ date: '2026-10-10', type: 'expense', amount: 40000, accountId: main.id, status: 'planned' });
    const f = forecast(data, '2026-10-05', '2026-10-31');
    expect(f.start).toBe(45000);
    // The overdue bill counts today, the second one breaks through zero.
    expect(f.points[0].value).toBe(35000);
    expect(f.firstNegative).toBe('2026-10-10');
    expect(f.end).toBe(-5000);
  });
});

describe('allocation', () => {
  it('covers bills in date order, uses money already on the envelope, stops when short', () => {
    const { data, main, bills, add } = household();
    // main 40000 free, bills envelope has 5000 free.
    const rent = add({ date: '2026-10-06', type: 'expense', amount: 30000, accountId: main.id });
    const phone = add({ date: '2026-10-08', type: 'expense', amount: 8000, accountId: bills.id });
    const tv = add({ date: '2026-10-09', type: 'expense', amount: 6000, accountId: bills.id });
    const gym = add({ date: '2026-10-11', type: 'expense', amount: 1000, accountId: bills.id });
    add({ date: '2026-10-12', type: 'expense', amount: 500, accountId: bills.id, isTransit: true });

    const plan = suggestAllocation(data, main.id, '2026-10-31');
    expect(plan.inPlace).toEqual([rent.id]);
    // phone: 5000 already sits on the envelope, only 3000 has to move.
    // The transit row is never part of a split.
    expect(plan.lines).toEqual([{ toAccountId: bills.id, amount: 3000 + 6000 + 1000, entryIds: [phone.id, tv.id, gym.id] }]);
    expect(plan.sourceFreeAfter).toBe(0);
    expect(plan.uncovered).toEqual([]);
  });

  it('leaves later bills uncovered once the money runs out', () => {
    const { data, main, bills, add } = household();
    const a = add({ date: '2026-10-06', type: 'expense', amount: 46000, accountId: bills.id });
    const b = add({ date: '2026-10-07', type: 'expense', amount: 100, accountId: bills.id });
    const plan = suggestAllocation(data, main.id, '2026-10-31');
    expect(plan.lines).toEqual([]);
    expect(plan.uncovered).toEqual([a.id, b.id]);
  });

  it('applying a plan moves money and reserves the bills', () => {
    const { data, main, bills, add } = household();
    const phone = add({ date: '2026-10-08', type: 'expense', amount: 8000, accountId: bills.id });
    const plan = suggestAllocation(data, main.id, '2026-10-31');
    const { newEntries, updates } = buildAllocation(plan, '2026-10-05');
    expect(newEntries).toHaveLength(1);
    expect(newEntries[0]).toMatchObject({ type: 'transfer', amount: 3000, accountId: main.id, toAccountId: bills.id, status: 'done' });
    expect(updates).toEqual([expect.objectContaining({ id: phone.id, status: 'reserved' })]);

    data.entries.push(...newEntries);
    Object.assign(phone, updates[0]);
    const s = accountSummaries(data);
    expect(s.get(bills.id).ownFree).toBe(0);
    expect(grandTotals(data).free).toBe(45000 - 8000);
  });

  it('defaults to the day before the next income', () => {
    const { data, main, add } = household();
    add({ date: '2026-11-03', type: 'income', amount: 1, accountId: main.id });
    expect(defaultAllocationEnd(data, '2026-10-05')).toBe('2026-11-02');
  });
});

describe('reconciliation', () => {
  it('turns the difference into a visible adjustment', () => {
    const { data, main } = household();
    const { diff, adjustment, check } = buildReconciliation(data, main.id, 38500, '2026-10-05', 'Small purchases');
    expect(diff).toBe(-1500);
    expect(adjustment).toMatchObject({ type: 'expense', amount: 1500, isAdjustment: true, status: 'done' });
    expect(check).toMatchObject({ actualBalance: 38500, computedBalance: 40000 });

    data.entries.push(adjustment);
    expect(accountSummaries(data).get(main.id).ownBalance).toBe(38500);
    expect(monthSummary(data, '2026-10').expense).toBe(0);
  });

  it('no adjustment when the bank agrees', () => {
    const { data, main } = household();
    expect(buildReconciliation(data, main.id, 40000, '2026-10-05').adjustment).toBe(null);
  });
});

describe('allocation by hand', () => {
  it('covers exactly the picked bills and reports a shortfall', async () => {
    const { planForSelection } = await import('../src/allocation.js');
    const { data, main, bills, add } = household();
    const a = add({ date: '2026-10-06', type: 'expense', amount: 30000, accountId: bills.id });
    add({ date: '2026-10-07', type: 'expense', amount: 1000, accountId: bills.id });
    const c = add({ date: '2026-10-08', type: 'expense', amount: 20000, accountId: main.id });
    const plan = planForSelection(data, main.id, [a.id, c.id], '2026-10-31');
    // a: 5000 already on the envelope, 25000 moved; c paid in place.
    expect(plan.lines).toEqual([{ toAccountId: bills.id, amount: 25000, entryIds: [a.id] }]);
    expect(plan.inPlace).toEqual([c.id]);
    expect(plan.shortfall).toBe(25000 + 20000 - 40000);
  });
});
