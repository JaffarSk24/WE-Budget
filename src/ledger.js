// Pure money calculations over the budget document. Nothing here mutates
// data; every function takes the document and returns numbers in cents.
//
// Two regimes, split by settings.trackingStart:
//  - from trackingStart on, balances are real: opening balance of each
//    account plus everything that actually happened (status "done");
//  - before it, entries are history imported from elsewhere. They are shown
//    in month views and analytics as one pooled running total, but never
//    touch account balances.

import { live, makeSchedule } from './model.js';
import { addDays, addMonthsToMonth, firstDayOfMonth, lastDayOfMonth, monthOf } from './dates.js';
import { occurrences, pendingGeneration } from './schedule.js';

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

// Money on the account of an active goal is frozen for that goal: it is not
// free for anything else. When the goal's account has envelopes, they are
// the goal's too, as in goalProgress.
export function frozenAccounts(data) {
  const goalAccounts = new Set(live(data.goals || []).filter(g => !g.archived && g.accountId).map(g => g.accountId));
  const ids = new Set(goalAccounts);
  live(data.accounts).forEach(a => { if (goalAccounts.has(a.parentId)) ids.add(a.id); });
  return ids;
}

// Signed effect of an entry on the budget: the money on all accounts except
// what is frozen for goals. A transfer into a goal's account leaves the
// budget like a payment and a transfer out of it comes back like an income;
// income and payments on a goal's account stay with the goal.
export function budgetEffect(entry, frozen) {
  const amount = entry.amount || 0;
  const counts = id => !frozen.has(id);
  if (entry.type === 'income') return counts(entry.accountId) ? amount : 0;
  if (entry.type === 'expense') return counts(entry.accountId) ? -amount : 0;
  if (entry.type === 'transfer') {
    return (counts(entry.toAccountId) ? amount : 0) - (counts(entry.accountId) ? amount : 0);
  }
  return 0;
}

// How an entry counts in the budget's income and expense totals: income and
// payments of the budget's money, money frozen for a goal as a payment and
// money released from a goal as income. Transit, adjustments and moves
// between the budget's own accounts do not count.
export function budgetFlow(entry, frozen) {
  if (entry.status === 'cancelled' || entry.isTransit || entry.isAdjustment) return null;
  const effect = budgetEffect(entry, frozen);
  if (!effect) return null;
  return effect < 0 ? { type: 'expense', amount: -effect } : { type: 'income', amount: effect };
}

// Per-account figures. `own*` covers the account alone, `total*` adds its
// envelopes (child accounts). On a goal's account, what is not set aside
// for its payments is frozen for the goal (`*Frozen`) instead of free.
export function accountSummaries(data, asOf = null) {
  const accounts = live(data.accounts);
  const frozen = frozenAccounts(data);
  const map = new Map();
  accounts.forEach(a => map.set(a.id, {
    id: a.id,
    ownBalance: a.openingBalance || 0,
    ownReserved: 0,
    ownFrozen: 0,
    ownFree: 0,
    totalBalance: 0,
    totalReserved: 0,
    totalFrozen: 0,
    totalFree: 0,
    isFrozen: frozen.has(a.id),
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

  map.forEach(s => {
    if (s.isFrozen) s.ownFrozen = Math.max(0, s.ownBalance - s.ownReserved);
    s.ownFree = s.ownBalance - s.ownReserved - s.ownFrozen;
  });
  accounts.forEach(a => {
    const s = map.get(a.id);
    s.totalBalance = s.ownBalance;
    s.totalReserved = s.ownReserved;
    s.totalFrozen = s.ownFrozen;
    accounts.filter(c => c.parentId === a.id).forEach(c => {
      const cs = map.get(c.id);
      s.totalBalance += cs.ownBalance;
      s.totalReserved += cs.ownReserved;
      s.totalFrozen += cs.ownFrozen;
    });
    s.totalFree = s.totalBalance - s.totalReserved - s.totalFrozen;
  });

  live(data.checks).forEach(c => {
    const s = map.get(c.accountId);
    if (s && (!s.lastCheck || c.date > s.lastCheck.date)) s.lastCheck = c;
  });
  return map;
}

// balance = free + reserved (for payments) + frozen (for goals).
export function grandTotals(data, asOf = null) {
  const summaries = accountSummaries(data, asOf);
  let balance = 0;
  let reserved = 0;
  let frozen = 0;
  live(data.accounts).forEach(a => {
    const s = summaries.get(a.id);
    balance += s.ownBalance;
    reserved += s.ownReserved;
    frozen += s.ownFrozen;
  });
  return { balance, reserved, frozen, free: balance - reserved - frozen };
}

// Opening balances of the budget's accounts, without those frozen for goals.
export function openingTotal(data, frozen = frozenAccounts(data)) {
  return live(data.accounts).filter(a => !frozen.has(a.id)).reduce((sum, a) => sum + (a.openingBalance || 0), 0);
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

// Running total of the budget before the first moment of `day`, counting
// every entry that is not cancelled (plan semantics, like the spreadsheet
// did). Money frozen for goals is not part of it.
export function runningTotalBefore(data, day, frozen = frozenAccounts(data)) {
  const start = trackingStartOf(data);
  const entries = live(data.entries).filter(e => e.status !== 'cancelled' && e.date < day);
  if (data.settings.trackingStart && day >= start) {
    return openingTotal(data, frozen) + entries
      .filter(e => e.date >= start)
      .reduce((sum, e) => sum + budgetEffect(e, frozen), 0);
  }
  return entries.reduce((sum, e) => sum + budgetEffect(e, frozen), 0);
}

// Rows of one month with a running total after each row, the replacement
// for the spreadsheet's hand-written cumulative columns.
export function monthRows(data, month) {
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const start = data.settings.trackingStart;
  const frozen = frozenAccounts(data);
  const rows = live(data.entries)
    .filter(e => e.date >= from && e.date <= to)
    .sort(compareEntries);

  let running = runningTotalBefore(data, from, frozen);
  let crossed = !start || from >= start;
  return rows.map(e => {
    if (!crossed && e.date >= start) {
      crossed = true;
      running = runningTotalBefore(data, e.date, frozen);
    }
    if (e.status !== 'cancelled') running += budgetEffect(e, frozen);
    return { entry: e, running };
  });
}

export function monthSummary(data, month) {
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const frozen = frozenAccounts(data);
  const entries = live(data.entries).filter(e => e.date >= from && e.date <= to);
  const sum = (filter) => entries.filter(filter).reduce((s, e) => s + (e.amount || 0), 0);
  const flows = (type, done = false) => entries.reduce((s, e) => {
    const f = budgetFlow(e, frozen);
    return f && f.type === type && (!done || e.status === 'done') ? s + f.amount : s;
  }, 0);

  const opening = runningTotalBefore(data, from, frozen);
  const rows = monthRows(data, month);
  const closing = rows.length ? rows[rows.length - 1].running : runningTotalBefore(data, addDays(to, 1), frozen);

  return {
    month,
    opening,
    closing,
    income: flows('income'),
    expense: flows('expense'),
    incomeDone: flows('income', true),
    expenseDone: flows('expense', true),
    adjustments: entries
      .filter(e => e.isAdjustment && e.status !== 'cancelled')
      .reduce((s, e) => s + budgetEffect(e, frozen), 0),
    reserved: sum(e => e.status === 'reserved' && !e.isTransit),
    openCount: entries.filter(e => isOpen(e)).length
  };
}

function countsInFlow(e) {
  return e.status !== 'cancelled' && !e.isTransit && !e.isAdjustment && e.type !== 'transfer';
}

// A month against its plan, for income and for expenses as the budget sees
// them (budgetFlow: money put aside for a goal is an expense). The plan is
// the planned amounts (quick expenses were never planned), the fact is what
// is marked done (quick expenses included), and open is what is still to
// come.
export function monthPlanFact(data, month) {
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  const frozen = frozenAccounts(data);
  const out = {
    income: { plan: 0, fact: 0, open: 0, quick: 0 },
    expense: { plan: 0, fact: 0, open: 0, quick: 0 }
  };
  live(data.entries).forEach(e => {
    if (e.date < from || e.date > to) return;
    const flow = budgetFlow(e, frozen);
    if (!flow) return;
    const row = out[flow.type];
    if (!e.isQuick) row.plan += e.plannedAmount ?? e.amount ?? 0;
    if (e.status === 'done') {
      row.fact += flow.amount;
      if (e.isQuick) row.quick += flow.amount;
    } else {
      row.open += flow.amount;
    }
  });
  return out;
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
  const frozen = frozenAccounts(data);
  const byDay = new Map();
  live(data.entries).forEach(e => {
    if (e.status === 'cancelled' || !isTracked(data, e) || !budgetEffect(e, frozen)) return;
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
      value += budgetEffect(e, frozen);
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

// The goal's own monthly contribution, a template linked to it.
export function goalContribution(data, goal) {
  return live(data.templates).find(t => t.goalId === goal.id) || null;
}

// What the plan brings to a goal by its deadline: open entries already in
// the plan and occurrences of active templates not generated yet, counted on
// the same accounts as goalProgress. Gives the expected balance on the
// deadline, what is missing for the target and how many payments of the
// goal's own contribution are still to come. `without` leaves one template
// out, to work out a contribution in its place.
export function goalOutlook(data, goal, today, { without = null } = {}) {
  const progress = goalProgress(data, goal, today);
  const contribution = goalContribution(data, goal);
  const out = { ...progress, contribution, projected: null, shortfall: null, contributionsLeft: 0 };
  if (!goal.deadline || !goal.accountId) return out;
  const ids = [goal.accountId, ...live(data.accounts).filter(a => a.parentId === goal.accountId).map(a => a.id)];
  const effect = e => ids.reduce((s, id) => s + accountEffect(e, id), 0);
  const own = e => contribution && e.templateId === contribution.id && e.status === 'planned' && e.date >= today;
  let planned = 0;
  live(data.entries).forEach(e => {
    if (!isOpen(e) || !isTracked(data, e) || e.date > goal.deadline || (without && e.templateId === without)) return;
    planned += effect(e);
    if (own(e)) out.contributionsLeft++;
  });
  if (goal.deadline >= today) {
    pendingGeneration(data, today, goal.deadline).entries.forEach(e => {
      if (without && e.templateId === without) return;
      planned += effect(e);
      if (own(e)) out.contributionsLeft++;
    });
  }
  out.projected = progress.saved + planned;
  out.shortfall = Math.max(0, progress.target - out.projected);
  return out;
}

// The contribution that closes the shortfall: the current amount plus the
// missing money spread over the payments still to come.
export function raisedContribution(outlook) {
  if (!outlook.contribution || !outlook.shortfall || !outlook.contributionsLeft) return null;
  return outlook.contribution.amount + Math.ceil(outlook.shortfall / outlook.contributionsLeft);
}

// A monthly contribution paid on `day` from today to the deadline that,
// on top of the rest of the plan, makes the target. `replacing` is the
// goal's current contribution when it is being changed.
export function suggestedContribution(data, goal, today, day, replacing = null) {
  const o = goalOutlook(data, goal, today, { without: replacing });
  if (o.projected === null) return { amount: null, count: 0, need: null };
  const schedule = makeSchedule({ freq: 'monthly', day, startDate: today, endDate: goal.deadline });
  const count = goal.deadline >= today ? occurrences(schedule, today, goal.deadline).length : 0;
  const need = Math.max(0, o.target - o.projected);
  return { amount: count ? Math.ceil(need / count) : need, count, need };
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
