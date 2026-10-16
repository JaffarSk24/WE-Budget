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
import { addDays, addMonthsToMonth, dayInMonth, daysBetween, firstDayOfMonth, lastDayOfMonth, monthOf } from './dates.js';
import { nextOccurrence, occurrences, pendingGeneration } from './schedule.js';
import { categoryParts } from './splits.js';

// Every per-category figure below counts the parts of a split payment in
// their own categories (categoryParts), never the whole in one.
export { categoryParts };

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
    categoryParts(e).forEach(p => totals.set(p.categoryId, (totals.get(p.categoryId) || 0) + p.amount));
  });
  return totals;
}

// Money spent this month in a category, for quick-expense limits.
export function categorySpentInMonth(data, categoryId, month) {
  return live(data.entries)
    .filter(e => e.type === 'expense' && e.status === 'done'
      && monthOf(e.date) === month && !e.isTransit && !e.isAdjustment)
    .reduce((s, e) => s + categoryParts(e).reduce((x, p) => x + (p.categoryId === categoryId ? p.amount : 0), 0), 0);
}

// What a category's limit carries into `month` (cents, may be negative with
// 'both'). Counting starts at rolloverFrom with rolloverCarry and walks the
// months up to the one before `month`, each month adding its limit and
// taking off what was spent. The current limit applies to every month: a
// changed limit restarts the count (see limitChangePatch), so history kept
// under the old limit does not get recounted.
export function limitCarry(data, category, month) {
  const limit = category && category.monthlyLimit > 0 ? category.monthlyLimit : 0;
  const mode = category && category.limitRollover;
  if (!limit || (mode !== 'unspent' && mode !== 'both') || !category.rolloverFrom || month < category.rolloverFrom) return 0;
  let carry = category.rolloverCarry || 0;
  for (let m = category.rolloverFrom; m < month; m = addMonthsToMonth(m, 1)) {
    const left = limit + carry - categorySpentInMonth(data, category.id, m);
    // 'unspent' never takes anything off: an overspent month starts the
    // next one from the plain limit.
    carry = mode === 'both' ? left : Math.max(0, left);
  }
  return carry;
}

// The limit of a category for `month`: its monthly limit plus what carried
// over, never below zero. Null when the category has no limit.
export function effectiveLimit(data, categoryId, month) {
  const category = live(data.categories).find(c => c.id === categoryId);
  if (!category || !(category.monthlyLimit > 0)) return null;
  return Math.max(0, category.monthlyLimit + limitCarry(data, category, month));
}

// Fields to save when the limit or the rollover option of a category changes
// in `month`. Switching carrying on starts it this month from nothing; a new
// limit keeps what was carried into this month under the old one.
export function limitChangePatch(data, category, { monthlyLimit = category.monthlyLimit, limitRollover = category.limitRollover || 'none' }, month) {
  const limit = monthlyLimit > 0 ? monthlyLimit : null;
  if (!limit || limitRollover === 'none') return { monthlyLimit: limit, limitRollover: limit ? limitRollover : 'none', rolloverFrom: null, rolloverCarry: 0 };
  const wasOn = (category.limitRollover === 'unspent' || category.limitRollover === 'both') && category.rolloverFrom && category.monthlyLimit > 0;
  if (!wasOn) return { monthlyLimit: limit, limitRollover, rolloverFrom: month, rolloverCarry: 0 };
  const carry = limitCarry(data, category, month);
  return {
    monthlyLimit: limit, limitRollover, rolloverFrom: month,
    rolloverCarry: limitRollover === 'unspent' ? Math.max(0, carry) : carry
  };
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
  // A goal that saves ahead for a payment is paid out by that payment on the
  // deadline: the payment is what the money is for, not a loss to cover.
  const skip = e => (without && e.templateId === without) || (goal.templateId && e.templateId === goal.templateId);
  let planned = 0;
  live(data.entries).forEach(e => {
    if (!isOpen(e) || !isTracked(data, e) || e.date > goal.deadline || skip(e)) return;
    planned += effect(e);
    if (own(e)) out.contributionsLeft++;
  });
  if (goal.deadline >= today) {
    pendingGeneration(data, today, goal.deadline).entries.forEach(e => {
      if (skip(e)) return;
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
  const need = Math.max(0, o.target - o.projected);
  return { ...monthlyNeeded(need, today, goal.deadline, day), need };
}

// Spreads `need` over monthly payments on `day` from today to the deadline
// (both included). Rounded up so that the last payment does not fall short;
// with no payment left the whole sum is due at once.
export function monthlyNeeded(need, today, deadline, day) {
  const schedule = makeSchedule({ freq: 'monthly', day, startDate: today, endDate: deadline });
  const count = deadline >= today ? occurrences(schedule, today, deadline).length : 0;
  return { amount: count ? Math.ceil(need / count) : need, count };
}

// ---------- saving ahead for payments that do not come every month ----------

// A yearly or every-N-months expense is the kind that catches a budget out:
// the money for it has to be put aside month by month beforehand.
export function canSaveAhead(template) {
  return !!template && template.type === 'expense' && !template.goalId && !template.isTransit
    && (template.schedule.freq === 'yearly' || template.schedule.freq === 'everyNMonths');
}

// The active goal that saves ahead for a template, if any.
export function saveAheadGoal(data, templateId) {
  return live(data.goals || []).find(g => g.templateId === templateId && !g.archived) || null;
}

// The day the money is being saved for: the earliest payment of the template
// still open after the last one that was paid or skipped, otherwise its next
// scheduled day from today on. Deriving it from the entries (instead of
// moving it when a payment is marked) makes undoing the mark move it back.
export function saveAheadDeadline(data, template, today) {
  const key = e => e.occurrence || e.date;
  const own = live(data.entries).filter(e => e.templateId === template.id);
  const last = own.filter(e => e.status === 'done' || e.status === 'cancelled').map(key).sort().pop() || null;
  const open = own.filter(e => isOpen(e) && (e.amount || 0) > 0 && (!last || key(e) > last))
    .sort((a, b) => key(a).localeCompare(key(b)))[0];
  if (open) return open.date;
  const after = last ? addDays(last, 1) : today;
  return nextOccurrence(template.schedule, after > today ? after : today);
}

// What a saving-ahead goal should look like now: the target is the payment's
// amount and the deadline its next open occurrence. Returns the patch, or
// null when the goal is up to date. Once the payment is marked done, this
// rolls the goal on to the next occurrence.
export function saveAheadRoll(data, goal, today) {
  if (!goal.templateId || goal.archived) return null;
  const template = live(data.templates).find(t => t.id === goal.templateId);
  if (!template) return null;
  const deadline = saveAheadDeadline(data, template, today);
  if (!deadline) return null;
  const targetAmount = template.amount || 0;
  if (deadline === goal.deadline && targetAmount === goal.targetAmount) return null;
  return { deadline, targetAmount };
}

// ---------- recurring costs ----------

function chargesPerYear(schedule) {
  switch (schedule.freq) {
    case 'monthly': return 12;
    case 'everyNMonths': return 12 / Math.max(1, schedule.interval || 1);
    case 'yearly': return 1;
    case 'weekly': return 52 * Math.max(1, (schedule.weekdays || []).length);
    default: return 0;
  }
}

// What a recurring payment costs per year and per month on average: a
// yearly payment counts a twelfth each month, every N months an Nth, weekly
// 52 times a year (per weekday). One-off payments are not recurring costs.
export function yearlyCost(template) {
  return Math.round((template.amount || 0) * chargesPerYear(template.schedule));
}

export function monthlyEquivalent(template) {
  return Math.round((template.amount || 0) * chargesPerYear(template.schedule) / 12);
}

// What a template actually charged: its payments marked done, oldest first.
// Zero rows (months an every-N-months payment is not due) charge nothing.
export function chargeHistory(data, templateId) {
  return live(data.entries)
    .filter(e => e.templateId === templateId && e.status === 'done' && (e.amount || 0) > 0)
    .map(e => ({ date: e.occurrence || e.date, amount: e.amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The latest change of price in a charge history: the charge whose amount
// differs from the one before it. `percent` is rounded to whole percent.
export function priceChange(history) {
  for (let i = history.length - 1; i > 0; i--) {
    const from = history[i - 1].amount;
    const to = history[i].amount;
    if (from === to) continue;
    return { from, to, date: history[i].date, percent: from ? Math.round(((to - from) / from) * 100) : null };
  }
  return null;
}

// The next charge of a template from today on: an open entry already in the
// plan (it may have been moved), otherwise the schedule's next due day.
export function nextCharge(data, template, today) {
  const open = live(data.entries)
    .filter(e => e.templateId === template.id && isOpen(e) && (e.amount || 0) > 0 && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return open ? open.date : nextOccurrence(template.schedule, today);
}

// Active recurring expenses with what they cost, the most expensive per year
// first. Pass-through payments are someone else's money and goal
// contributions are savings, so neither is a cost. `categoryId` keeps one
// category with its subcategories.
export function recurringOverview(data, today, { categoryId = null } = {}) {
  const inCategory = id => {
    if (!categoryId) return true;
    if (id === categoryId) return true;
    const c = live(data.categories).find(x => x.id === id);
    return !!c && c.parentId === categoryId;
  };
  const rows = live(data.templates)
    .filter(t => t.active && t.type === 'expense' && !t.isTransit && !t.goalId && t.schedule.freq !== 'once'
      && !(t.schedule.endDate && t.schedule.endDate < today) && inCategory(t.categoryId))
    .map(t => {
      const history = chargeHistory(data, t.id);
      return {
        template: t,
        monthly: monthlyEquivalent(t),
        yearly: yearlyCost(t),
        next: nextCharge(data, t, today),
        last: history.length ? history[history.length - 1] : null,
        // Estimated amounts (electricity, water) change every time; a
        // change of price only means something for a fixed one.
        change: t.amountIsEstimate ? null : priceChange(history)
      };
    })
    .sort((a, b) => (b.yearly - a.yearly) || a.template.title.localeCompare(b.template.title));
  return {
    rows,
    monthly: rows.reduce((s, r) => s + r.monthly, 0),
    yearly: rows.reduce((s, r) => s + r.yearly, 0)
  };
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
    categoryParts(e).forEach(p => totals.set(p.categoryId, (totals.get(p.categoryId) || 0) + p.amount));
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

// ---------- runway and alerts ----------

export const RUNWAY_WINDOW_DAYS = 90;

// How many days the free money lasts at the usual spending: the average
// daily expense of the last 90 days as the budget sees it (budgetFlow, so
// transit, adjustments and moves between own accounts do not count; money
// put aside for a goal does). Only what took place counts: planned payments
// are the plan, not spending. A shorter history is averaged over its own
// length, from the first day anything took place.
//
// status: 'ok' with `days`, 'negative' when free money is below zero,
// 'no-history' when nothing took place yet, 'no-spending' when nothing was
// spent in the window (the runway would be infinite).
export function runway(data, today, { windowDays = RUNWAY_WINDOW_DAYS } = {}) {
  const { free } = grandTotals(data, today);
  const frozen = frozenAccounts(data);
  const windowStart = addDays(today, -(windowDays - 1));
  let first = null;
  let spent = 0;
  live(data.entries).forEach(e => {
    if (e.status !== 'done' || e.date > today) return;
    const flow = budgetFlow(e, frozen);
    if (!flow) return;
    if (!first || e.date < first) first = e.date;
    if (flow.type === 'expense' && e.date >= windowStart) spent += flow.amount;
  });
  const out = { free, spent, daily: 0, historyDays: 0, days: null, status: 'ok' };
  if (first) {
    const from = first > windowStart ? first : windowStart;
    out.historyDays = daysBetween(from, today) + 1;
    out.daily = Math.round(spent / out.historyDays);
  }
  if (free < 0) out.status = 'negative';
  else if (!first) out.status = 'no-history';
  else if (spent <= 0) out.status = 'no-spending';
  else out.days = Math.floor((free * out.historyDays) / spent);
  return out;
}

export const LARGE_PAYMENT_DAYS = 3;

// What needs a look now, from the alert settings: categories at 80% and at
// 100% of their monthly limit, free money below the threshold, and large
// payments due in the next three days. Each alert carries a `key` that stays
// the same for the same situation on the same day (a notification is shown
// once per key and day). Empty when alerts are switched off.
export function budgetAlerts(data, today) {
  const s = data.settings || {};
  // A budget without accounts has nothing to warn about yet.
  if (s.alertsEnabled === false || !live(data.accounts).length) return [];
  const alerts = [];
  const month = monthOf(today);

  live(data.categories)
    .filter(c => c.type === 'expense' && !c.archived && c.monthlyLimit > 0)
    .forEach(c => {
      const spent = categorySpentInMonth(data, c.id, month);
      // A limit carried down to zero is used up by any spending.
      const limit = effectiveLimit(data, c.id, month);
      const percent = limit > 0 ? Math.floor((spent / limit) * 100) : (spent > 0 ? 100 : 0);
      if (percent < 80) return;
      const kind = percent >= 100 ? 'limit-over' : 'limit-near';
      alerts.push({
        key: `${kind}:${c.id}:${month}`, kind, level: kind === 'limit-over' ? 'danger' : 'warning',
        categoryId: c.id, name: c.name, spent, limit, percent
      });
    });

  const threshold = s.alertFreeBelow;
  if (threshold !== null && threshold !== undefined && Number.isFinite(threshold)) {
    const { free } = grandTotals(data, today);
    if (free < threshold) {
      alerts.push({ key: 'free-low', kind: 'free-low', level: free < 0 ? 'danger' : 'warning', free, threshold });
    }
  }

  const large = s.alertLargePayment;
  if (large !== null && large !== undefined && Number.isFinite(large) && large > 0) {
    upcomingEntries(data, today, addDays(today, LARGE_PAYMENT_DAYS))
      .filter(e => e.type === 'expense' && !e.isTransit && (e.amount || 0) > large && isTracked(data, e))
      .forEach(e => alerts.push({
        key: `large:${e.id}:${e.date}`, kind: 'large-payment', level: 'info',
        entryId: e.id, name: e.title, amount: e.amount, date: e.date, reserved: e.status === 'reserved'
      }));
  }
  return alerts;
}

// ---------- what-if drafts ----------

// Days a draft falls on within [today, toDay]. A one-off draft dated in the
// past counts today, like an overdue planned payment; a monthly one keeps
// its day of the month (clamped to short months) and stops after `months`.
export function scenarioDays(scenario, today, toDay) {
  if (!scenario || !scenario.date || !scenario.amount) return [];
  if (scenario.repeat !== 'monthly') {
    const day = scenario.date < today ? today : scenario.date;
    return day <= toDay ? [day] : [];
  }
  const dayOfMonth = Number(scenario.date.slice(8, 10));
  const endDate = scenario.months
    ? dayInMonth(addMonthsToMonth(monthOf(scenario.date), scenario.months - 1), dayOfMonth)
    : null;
  return occurrences(makeSchedule({ freq: 'monthly', day: dayOfMonth, startDate: scenario.date, endDate }), today, toDay);
}

// Active drafts as planned entries that exist only for the calculation.
// They never reach data.entries.
export function scenarioEntries(scenarios, today, toDay) {
  return live(scenarios).filter(s => s.active).flatMap(s => scenarioDays(s, today, toDay).map(day => ({
    id: `scenario:${s.id}:${day}`,
    scenarioId: s.id,
    date: day,
    title: s.title,
    type: s.type === 'income' ? 'income' : 'expense',
    amount: s.amount,
    accountId: s.accountId,
    categoryId: s.categoryId,
    status: 'planned',
    createdAt: s.createdAt,
    deleted: false
  })));
}

// The free-money forecast with the active drafts on top of the real plan.
// Same shape as forecast(); without active drafts it is the same result.
export function forecastWithScenarios(data, today, toDay, scenarios = data.scenarios) {
  const extra = scenarioEntries(scenarios || [], today, toDay);
  if (!extra.length) return forecast(data, today, toDay);
  return forecast({ ...data, entries: [...(data.entries || []), ...extra] }, today, toDay);
}

// What the active drafts change: the lowest free money with and without
// them (and its day), the difference at the end of the forecast and the
// first day free money goes below zero with the drafts.
export function scenarioImpact(data, today, toDay, scenarios = data.scenarios) {
  const base = forecast(data, today, toDay);
  const withDrafts = forecastWithScenarios(data, today, toDay, scenarios);
  return {
    active: scenarioEntries(scenarios || [], today, toDay).length > 0,
    lowest: withDrafts.minimum,
    lowestWithout: base.minimum,
    end: withDrafts.end,
    endWithout: base.end,
    endDifference: withDrafts.end - base.end,
    firstNegative: withDrafts.firstNegative,
    firstNegativeWithout: base.firstNegative
  };
}
