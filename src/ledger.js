// Pure money calculations over the budget document. Nothing here mutates
// data; every function takes the document and returns numbers in cents.
//
// Two regimes, split by settings.trackingStart:
//  - from trackingStart on, balances are real: opening balance of each
//    account plus everything that actually happened (status "done");
//  - before it, entries are history imported from elsewhere. They are shown
//    in month views and analytics as one pooled running total, but never
//    touch account balances.

import { live } from './model.js';
import { addDays, addMonthsToMonth, firstDayOfMonth, lastDayOfMonth, monthOf } from './dates.js';

const OPEN_STATUSES = ['planned', 'reserved'];

export function isOpen(entry) {
  return OPEN_STATUSES.includes(entry.status);
}

function trackingStartOf(data) {
  return data.settings.trackingStart || '0000-01-01';
}

function isTracked(data, entry) {
  return entry.date >= trackingStartOf(data);
}

// Signed effect of an entry on one account, regardless of status.
export function accountEffect(entry, accountId) {
  const amount = entry.amount || 0;
  if (entry.type === 'income') return entry.accountId === accountId ? amount : 0;
  if (entry.type === 'expense') return entry.accountId === accountId ? -amount : 0;
  if (entry.type === 'transfer') {
    let effect = 0;
    if (entry.accountId === accountId) effect -= amount;
    if (entry.toAccountId === accountId) effect += amount;
    return effect;
  }
  return 0;
}

// Signed effect on the sum of all accounts. Transfers move money between
// accounts and leave the total unchanged.
export function totalEffect(entry) {
  if (entry.type === 'income') return entry.amount || 0;
  if (entry.type === 'expense') return -(entry.amount || 0);
  return 0;
}

// Per-account figures. `own*` covers the account alone, `total*` adds its
// envelopes (child accounts).
export function accountSummaries(data, asOf = null) {
  const accounts = live(data.accounts);
  const map = new Map();
  accounts.forEach(a => map.set(a.id, {
    id: a.id,
    ownBalance: a.openingBalance || 0,
    ownReserved: 0,
    ownFree: 0,
    totalBalance: 0,
    totalReserved: 0,
    totalFree: 0,
    lastCheck: null
  }));

  live(data.entries).forEach(e => {
    if (!isTracked(data, e)) return;
    if (e.status === 'done' && (!asOf || e.date <= asOf)) {
      new Set([e.accountId, e.toAccountId]).forEach(id => {
        if (id && map.has(id)) map.get(id).ownBalance += accountEffect(e, id);
      });
    }
    // Pass-through money pays for itself when its pair arrives; nothing can
    // be set aside for it.
    if (e.status === 'reserved' && e.type === 'expense' && !e.isTransit && map.has(e.accountId)) {
      map.get(e.accountId).ownReserved += e.amount || 0;
    }
  });

  map.forEach(s => { s.ownFree = s.ownBalance - s.ownReserved; });
  accounts.forEach(a => {
    const s = map.get(a.id);
    s.totalBalance = s.ownBalance;
    s.totalReserved = s.ownReserved;
    accounts.filter(c => c.parentId === a.id).forEach(c => {
      const cs = map.get(c.id);
      s.totalBalance += cs.ownBalance;
      s.totalReserved += cs.ownReserved;
    });
    s.totalFree = s.totalBalance - s.totalReserved;
  });

  live(data.checks).forEach(c => {
    const s = map.get(c.accountId);
    if (s && (!s.lastCheck || c.date > s.lastCheck.date)) s.lastCheck = c;
  });
  return map;
}

export function grandTotals(data, asOf = null) {
  const summaries = accountSummaries(data, asOf);
  let balance = 0;
  let reserved = 0;
  live(data.accounts).forEach(a => {
    const s = summaries.get(a.id);
    balance += s.ownBalance;
    reserved += s.ownReserved;
  });
  return { balance, reserved, free: balance - reserved };
}

export function openingTotal(data) {
  return live(data.accounts).reduce((sum, a) => sum + (a.openingBalance || 0), 0);
}

// Order inside a day: income first, then everything else in creation order,
// so a payday never shows a dip that does not really happen.
export function compareEntries(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const rank = (e) => (e.type === 'income' ? 0 : e.type === 'transfer' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if ((a.sortKey ?? 0) !== (b.sortKey ?? 0)) return (a.sortKey ?? 0) - (b.sortKey ?? 0);
  return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
}

// Running total before the first moment of `day`, counting every entry that
// is not cancelled (plan semantics, like the spreadsheet did).
export function runningTotalBefore(data, day) {
  const start = trackingStartOf(data);
  const entries = live(data.entries).filter(e => e.status !== 'cancelled' && e.date < day);
  if (data.settings.trackingStart && day >= start) {
    return openingTotal(data) + entries
      .filter(e => e.date >= start)
      .reduce((sum, e) => sum + totalEffect(e), 0);
  }
  return entries.reduce((sum, e) => sum + totalEffect(e), 0);
}

// Rows of one month with a running total after each row, the replacement
// for the spreadsheet's hand-written cumulative columns.
export function monthRows(data, month) {
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const start = data.settings.trackingStart;
  const rows = live(data.entries)
    .filter(e => e.date >= from && e.date <= to)
    .sort(compareEntries);

  let running = runningTotalBefore(data, from);
  let crossed = !start || from >= start;
  return rows.map(e => {
    if (!crossed && e.date >= start) {
      crossed = true;
      running = runningTotalBefore(data, e.date);
    }
    if (e.status !== 'cancelled') running += totalEffect(e);
    return { entry: e, running };
  });
}

function countsInFlow(e) {
  return e.status !== 'cancelled' && !e.isTransit && !e.isAdjustment && e.type !== 'transfer';
}

export function monthSummary(data, month) {
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const entries = live(data.entries).filter(e => e.date >= from && e.date <= to);
  const sum = (filter) => entries.filter(filter).reduce((s, e) => s + (e.amount || 0), 0);

  const opening = runningTotalBefore(data, from);
  const rows = monthRows(data, month);
  const closing = rows.length ? rows[rows.length - 1].running : runningTotalBefore(data, addDays(to, 1));

  return {
    month,
    opening,
    closing,
    income: sum(e => countsInFlow(e) && e.type === 'income'),
    expense: sum(e => countsInFlow(e) && e.type === 'expense'),
    incomeDone: sum(e => countsInFlow(e) && e.type === 'income' && e.status === 'done'),
    expenseDone: sum(e => countsInFlow(e) && e.type === 'expense' && e.status === 'done'),
    adjustments: entries
      .filter(e => e.isAdjustment && e.status !== 'cancelled')
      .reduce((s, e) => s + totalEffect(e), 0),
    reserved: sum(e => e.status === 'reserved' && !e.isTransit),
    openCount: entries.filter(e => isOpen(e)).length
  };
}

// Open entries dated before `today` (from trackingStart on).
export function overdueEntries(data, today) {
  return live(data.entries)
    .filter(e => isOpen(e) && e.date < today && isTracked(data, e))
    .sort(compareEntries);
}

export function entriesOn(data, day, { openOnly = false } = {}) {
  return live(data.entries)
    .filter(e => e.date === day && (!openOnly || isOpen(e)))
    .sort(compareEntries);
}

export function upcomingEntries(data, fromDay, toDay) {
  return live(data.entries)
    .filter(e => isOpen(e) && e.date >= fromDay && e.date <= toDay)
    .sort(compareEntries);
}

// Balance of each account after every entry, from the tracking start on,
// in the order the month view shows them. This is what the month view's
// balance column shows: the money on the row's own account after that row,
// not the sum of all accounts (money on other envelopes is booked for their
// own payments). Returns Map(entryId -> { accountId: balance after }).
export function accountRunning(data) {
  const start = trackingStartOf(data);
  const balances = new Map(live(data.accounts).map(a => [a.id, a.openingBalance || 0]));
  const result = new Map();
  live(data.entries)
    .filter(e => e.status !== 'cancelled' && e.date >= start)
    .sort(compareEntries)
    .forEach(e => {
      const after = {};
      new Set([e.accountId, e.toAccountId]).forEach(id => {
        if (!id) return;
        balances.set(id, (balances.get(id) || 0) + accountEffect(e, id));
        after[id] = balances.get(id);
      });
      result.set(e.id, after);
    });
  return result;
}

// Day-by-day projection of FREE money from today: what is on the accounts
// minus what is set aside, then incomes in and payments that have no money
// set aside out. A payment with money set aside does not change free money:
// it was taken out when the money was set aside. Open entries dated in the
// past count today; an entry marked done but dated later counts on its date.
//
// firstNegative is the first payment free money does not cover, with the
// free money left after it (minus the part that is missing).
export function forecast(data, today, toDay) {
  const { free } = grandTotals(data, today);
  const byDay = new Map();
  live(data.entries).forEach(e => {
    if (e.status === 'cancelled' || e.type === 'transfer' || !isTracked(data, e)) return;
    let day;
    if (e.status === 'planned') day = e.date < today ? today : e.date;
    else if (e.status === 'done' && e.date > today) day = e.date;
    else return;
    if (day > toDay) return;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  });

  const points = [];
  let value = free;
  let firstNegative = null;
  let minimum = { day: today, value: free };
  for (let day = today; day <= toDay; day = addDays(day, 1)) {
    (byDay.get(day) || []).sort(compareEntries).forEach(e => {
      value += totalEffect(e);
      if (value < 0 && !firstNegative) firstNegative = { day, value, entry: e };
    });
    points.push({ day, value });
    if (value < minimum.value) minimum = { day, value };
  }
  return { start: free, points, firstNegative, minimum, end: value };
}

// Sum per category for a period, only real flows (no transit, transfers
// or reconciliation adjustments).
export function categoryTotals(data, fromDay, toDay, type = 'expense') {
  const totals = new Map();
  live(data.entries).forEach(e => {
    if (e.type !== type || !countsInFlow(e) || e.date < fromDay || e.date > toDay) return;
    const key = e.categoryId || null;
    totals.set(key, (totals.get(key) || 0) + (e.amount || 0));
  });
  return totals;
}

// Money spent this month in a category, for quick-expense limits.
export function categorySpentInMonth(data, categoryId, month) {
  return live(data.entries)
    .filter(e => e.categoryId === categoryId && e.type === 'expense' && e.status === 'done'
      && monthOf(e.date) === month && !e.isTransit && !e.isAdjustment)
    .reduce((s, e) => s + (e.amount || 0), 0);
}

// Progress of a savings goal: what lies on its envelope (the whole group when
// the account has envelopes), what is left, and how much to set aside per
// month to make it by the deadline (the current month counts).
export function goalProgress(data, goal, today) {
  const summaries = accountSummaries(data, today);
  const s = goal.accountId ? summaries.get(goal.accountId) : null;
  const hasEnvelopes = goal.accountId && live(data.accounts).some(a => a.parentId === goal.accountId);
  const saved = s ? (hasEnvelopes ? s.totalBalance : s.ownBalance) : 0;
  const target = goal.targetAmount || 0;
  const remaining = Math.max(0, target - saved);
  const percent = target > 0 ? Math.min(100, Math.floor((Math.max(0, saved) / target) * 100)) : 0;
  let monthsLeft = null;
  let perMonth = null;
  let late = false;
  if (goal.deadline) {
    const [ty, tm] = today.split('-').map(Number);
    const [dy, dm] = goal.deadline.split('-').map(Number);
    monthsLeft = (dy - ty) * 12 + (dm - tm) + 1;
    late = goal.deadline < today && remaining > 0;
    if (monthsLeft < 1) monthsLeft = 0;
    perMonth = remaining > 0 ? (monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : remaining) : 0;
  }
  return { saved, target, remaining, percent, monthsLeft, perMonth, late, reached: target > 0 && remaining === 0 };
}

// ---------- analytics ----------

// What counts as real money in analytics: incomes and expenses that took
// place, without pass-through money, transfers between own accounts and
// reconciliation adjustments (those are shown apart).
function realFlow(e) {
  return e.status === 'done' && !e.isTransit && !e.isAdjustment && (e.type === 'income' || e.type === 'expense');
}

// Month by month from `fromMonth` to `toMonth`: what came in and went out,
// the plan for expenses (planned amounts of planned payments not
// cancelled; quick expenses were never planned) and the sum of adjustments.
export function analyticsByMonth(data, fromMonth, toMonth) {
  const rows = new Map();
  for (let m = fromMonth; m <= toMonth; m = addMonthsToMonth(m, 1)) {
    rows.set(m, { month: m, income: 0, expense: 0, plan: 0, adjustments: 0 });
  }
  live(data.entries).forEach(e => {
    const row = rows.get(monthOf(e.date));
    if (!row) return;
    if (e.isAdjustment) {
      if (e.status === 'done') row.adjustments += (e.type === 'expense' ? -1 : 1) * (e.amount || 0);
      return;
    }
    if (e.status === 'cancelled' || e.isTransit || e.type === 'transfer') return;
    if (e.type === 'expense' && !e.isQuick) row.plan += e.plannedAmount ?? e.amount ?? 0;
    if (realFlow(e)) row[e.type] += e.amount || 0;
  });
  return [...rows.values()];
}

// Totals per category for a period, largest first.
export function categoryBreakdown(data, fromDay, toDay, type = 'expense') {
  const totals = new Map();
  live(data.entries).forEach(e => {
    if (e.type !== type || !realFlow(e) || e.date < fromDay || e.date > toDay) return;
    const key = e.categoryId || null;
    totals.set(key, (totals.get(key) || 0) + (e.amount || 0));
  });
  return [...totals.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .filter(r => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

// Average per month of each category over the `n` full months before
// `month` (the month in progress would pull the average down).
export function categoryAverages(data, month, n, type = 'expense') {
  const from = firstDayOfMonth(addMonthsToMonth(month, -n));
  const to = lastDayOfMonth(addMonthsToMonth(month, -1));
  return new Map(categoryBreakdown(data, from, to, type).map(r => [r.categoryId, Math.round(r.amount / n)]));
}

// The first month with any real income or expense: where "all history"
// starts.
export function firstFlowMonth(data) {
  let first = null;
  live(data.entries).forEach(e => {
    if (realFlow(e) && (!first || e.date < first)) first = e.date;
  });
  return first ? monthOf(first) : null;
}
