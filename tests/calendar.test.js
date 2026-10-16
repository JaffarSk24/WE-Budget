import { describe, it, expect } from 'vitest';
import { calendarWeeks } from '../src/calendar.js';
import { makeEntry } from '../src/model.js';

const e = (f) => makeEntry({ accountId: 'a', ...f });

describe('calendarWeeks', () => {
  it('lays a month out in weeks from Monday to Sunday with the neighbouring days', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = calendarWeeks('2026-10', []);
    expect(weeks).toHaveLength(5);
    expect(weeks[0].days.map(d => d.day)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weeks[0].days.map(d => d.inMonth)).toEqual([false, false, false, true, true, true, true]);
    expect(weeks[4].days[6]).toMatchObject({ day: '2026-11-01', inMonth: false, weekday: 6, isWeekend: true });
    expect(weeks.every(w => w.days.length === 7)).toBe(true);
    expect(weeks[1].days.filter(d => d.isWeekend).map(d => d.day)).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('handles a month that starts on Monday and one that needs six weeks', () => {
    // February 2027 starts on a Monday and has exactly four weeks.
    const feb = calendarWeeks('2027-02', []);
    expect(feb).toHaveLength(4);
    expect(feb[0].days[0].day).toBe('2027-02-01');
    expect(feb[3].days[6].day).toBe('2027-02-28');
    // August 2026 starts on a Saturday and ends on a Monday.
    expect(calendarWeeks('2026-08', [])).toHaveLength(6);
  });

  it('groups entries by day in day order and adds up each day and week', () => {
    const rent = e({ date: '2026-10-01', title: 'Rent', type: 'expense', amount: 90000 });
    const salary = e({ date: '2026-10-01', title: 'Salary', type: 'income', amount: 250000 });
    const move = e({ date: '2026-10-01', title: 'To savings', type: 'transfer', amount: 5000, toAccountId: 'b' });
    const gone = e({ date: '2026-10-02', title: 'Gone', type: 'expense', amount: 700, status: 'cancelled' });
    const lead = e({ date: '2026-09-29', title: 'Lunch', type: 'expense', amount: 1200 });
    const outside = e({ date: '2026-11-20', title: 'Far', type: 'expense', amount: 100 });
    const removed = { ...e({ date: '2026-10-03', type: 'expense', amount: 100 }), deleted: true };
    const weeks = calendarWeeks('2026-10', [rent, salary, move, gone, lead, outside, removed]);
    const day = weeks[0].days[3];
    // Income first, as in the table.
    expect(day.entries.map(x => x.title)).toEqual(['Salary', 'To savings', 'Rent']);
    expect(day).toMatchObject({ income: 250000, expense: 90000, net: 160000 });
    expect(weeks[0].days[4]).toMatchObject({ net: 0 });
    expect(weeks[0].days[4].entries).toHaveLength(1);
    expect(weeks[0].days[1].net).toBe(-1200);
    expect(weeks[0].days[5].entries).toHaveLength(0);
    expect(weeks[0]).toMatchObject({ income: 250000, expense: 91200, net: 158800 });
    expect(weeks.flatMap(w => w.days).flatMap(d => d.entries).map(x => x.title)).not.toContain('Far');
  });

  it('counts with the flow it is given', () => {
    const move = e({ date: '2026-10-05', type: 'transfer', amount: 5000, toAccountId: 'goal' });
    const flow = (x) => (x.type === 'transfer' ? { type: 'expense', amount: x.amount } : null);
    expect(calendarWeeks('2026-10', [move], { flow })[1].days[0].net).toBe(-5000);
  });
});
