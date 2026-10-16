// The month as a calendar grid: weeks from Monday to Sunday, with the days
// of the neighbouring months that fill the first and the last week. Pure,
// so the Month screen only draws what this returns.

import { addDays, firstDayOfMonth, lastDayOfMonth, monthOf, weekdayIndex } from './dates.js';
import { compareEntries } from './ledger.js';

// How an entry counts in a day's total. The Month screen passes budgetFlow
// so the calendar adds up like the table; this default keeps the function
// usable on its own: cancelled rows and transfers do not count.
function plainFlow(e) {
  if (e.status === 'cancelled' || e.type === 'transfer' || e.isTransit || e.isAdjustment) return null;
  return { type: e.type === 'income' ? 'income' : 'expense', amount: e.amount || 0 };
}

// Weeks of `month` (YYYY-MM) with `entries` grouped by day. Every week has
// seven days { day, inMonth, weekday (0 = Monday), isWeekend, entries,
// income, expense, net }; weeks carry their own income, expense and net.
// Entries outside the shown weeks are ignored.
export function calendarWeeks(month, entries, { flow = plainFlow } = {}) {
  const first = firstDayOfMonth(month);
  const last = lastDayOfMonth(month);
  const from = addDays(first, -weekdayIndex(first));
  const to = addDays(last, 6 - weekdayIndex(last));

  const byDay = new Map();
  (entries || []).forEach(e => {
    if (!e || e.deleted || !e.date || e.date < from || e.date > to) return;
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  });

  const weeks = [];
  for (let start = from; start <= to; start = addDays(start, 7)) {
    const week = { start, days: [], income: 0, expense: 0, net: 0 };
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const list = (byDay.get(day) || []).slice().sort(compareEntries);
      let income = 0;
      let expense = 0;
      list.forEach(e => {
        const f = flow(e);
        if (!f) return;
        if (f.type === 'income') income += f.amount;
        else expense += f.amount;
      });
      week.days.push({
        day, inMonth: monthOf(day) === month, weekday: i, isWeekend: i >= 5,
        entries: list, income, expense, net: income - expense
      });
      week.income += income;
      week.expense += expense;
    }
    week.net = week.income - week.expense;
    weeks.push(week);
  }
  return weeks;
}
