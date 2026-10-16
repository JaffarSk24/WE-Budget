// Matching a bank statement to the budget: which bank rows are payments
// that were planned (mark them done), which are already in the budget
// (skip) and which are new (add them). Pure functions; the dialog shows the
// proposals and lets the person change any of them.

import { live, makeEntry, nowIso } from '../model.js';
import { daysBetween } from '../dates.js';
import { applyRules } from '../rules.js';

// Days a bank date may differ from the planned one, and from a payment
// already marked done.
export const PLAN_WINDOW_DAYS = 5;
export const DONE_WINDOW_DAYS = 2;
// An estimated amount (a template marked "approximate") matches within this
// share of the planned amount.
export const ESTIMATE_TOLERANCE = 0.1;
// Open entries offered for a manual match: this many days around the row.
const MANUAL_WINDOW_DAYS = 45;

// The account and its envelopes: the bank sees them as one account.
export function accountGroup(data, accountId) {
  const ids = new Set([accountId]);
  live(data.accounts).forEach(a => { if (a.parentId === accountId) ids.add(a.id); });
  return ids;
}

// How an entry shows on the bank account of the group: -1 money out, +1
// money in, 0 not at all (a transfer between the account and its own
// envelopes never reaches the bank; adjustments are the app's own fixes).
export function bankSign(entry, ids) {
  if (entry.isAdjustment) return 0;
  const from = ids.has(entry.accountId);
  if (entry.type === 'expense') return from ? -1 : 0;
  if (entry.type === 'income') return from ? 1 : 0;
  const to = ids.has(entry.toAccountId);
  if (from && !to) return -1;
  if (to && !from) return 1;
  return 0;
}

function isEstimate(data, entry) {
  if (!entry.templateId) return false;
  const tpl = (data.templates || []).find(t => t.id === entry.templateId);
  return !!(tpl && tpl.amountIsEstimate);
}

// Whether a bank amount (cents, positive) fits a planned one.
export function amountFits(bank, planned, estimate) {
  if (bank === planned) return true;
  if (!estimate) return false;
  return Math.abs(bank - planned) <= Math.round(Math.abs(planned) * ESTIMATE_TOLERANCE);
}

// Pairs rows with entries, closest date first (then the closest amount):
// one row takes one entry, one entry is used once.
function pairUp(pairs, rowsTaken, entriesTaken, assign) {
  pairs
    .sort((a, b) => a.days - b.days || a.diff - b.diff || a.row - b.row)
    .forEach(p => {
      if (rowsTaken.has(p.row) || entriesTaken.has(p.entry.id)) return;
      rowsTaken.add(p.row);
      entriesTaken.add(p.entry.id);
      assign(p);
    });
}

function ruleFor(rules, row) {
  return applyRules(rules, {
    text: row.description,
    note: [row.counterparty, row.note].filter(Boolean).join(' '),
    type: row.type,
    amount: Math.abs(row.amount)
  });
}

// Proposals for every bank row of `rows` (with `key` from withImportKeys):
// { row, action: 'match' | 'recorded' | 'new' | 'skip', entryId, options,
//   categoryId, title, note, accountId, ruleId, beforeStart, future }.
// `options` are the open entries the row could be matched to by hand.
export function matchStatement(data, accountId, rows, today = null) {
  const ids = accountGroup(data, accountId);
  const entries = live(data.entries);
  const rules = live(data.rules);
  const start = (data.settings && data.settings.trackingStart) || null;
  const proposals = rows.map(row => {
    const rule = ruleFor(rules, row);
    const ruleAccount = rule && rule.accountId && ids.has(rule.accountId) ? rule.accountId : null;
    const title = (rule && rule.title) || row.description || row.counterparty || '';
    const note = [row.counterparty && row.counterparty !== title ? row.counterparty : null, row.note].filter(Boolean).join(' · ');
    return {
      row, action: 'new', entryId: null, options: [],
      categoryId: rule ? rule.categoryId : null,
      ruleId: rule ? rule.id : null,
      title, note,
      accountId: ruleAccount || accountId,
      beforeStart: !!(start && row.date < start)
    };
  });
  const rowsTaken = new Set();
  const entriesTaken = new Set();

  // 1. Rows imported before carry their key on the entry.
  const byKey = new Map();
  entries.forEach(e => { if (e.importKey) byKey.set(e.importKey, e); });
  proposals.forEach((p, i) => {
    const e = byKey.get(p.row.key);
    if (!e || entriesTaken.has(e.id)) return;
    rowsTaken.add(i);
    entriesTaken.add(e.id);
    Object.assign(p, { action: 'recorded', entryId: e.id });
  });

  // 2. Payments already marked done by hand: same amount, a day or two
  // apart. Entries that came from an import belong to their own bank row.
  const done = entries.filter(e => e.status === 'done' && !e.importKey && bankSign(e, ids) !== 0);
  const donePairs = [];
  proposals.forEach((p, i) => {
    if (rowsTaken.has(i)) return;
    done.forEach(e => {
      if (bankSign(e, ids) * Math.abs(e.amount) !== p.row.amount) return;
      const days = Math.abs(daysBetween(e.date, p.row.date));
      if (days <= DONE_WINDOW_DAYS) donePairs.push({ row: i, entry: e, days, diff: 0 });
    });
  });
  pairUp(donePairs, rowsTaken, entriesTaken, (p) => Object.assign(proposals[p.row], { action: 'recorded', entryId: p.entry.id }));

  // 3. Planned and set-aside payments of the plan.
  const open = entries.filter(e => (e.status === 'planned' || e.status === 'reserved') && bankSign(e, ids) !== 0);
  const planPairs = [];
  proposals.forEach((p, i) => {
    const amount = Math.abs(p.row.amount);
    const sign = Math.sign(p.row.amount);
    p.options = open
      .filter(e => bankSign(e, ids) === sign && Math.abs(daysBetween(e.date, p.row.date)) <= MANUAL_WINDOW_DAYS)
      .map(e => ({ e, days: Math.abs(daysBetween(e.date, p.row.date)), diff: Math.abs(e.amount - amount) }))
      .sort((a, b) => a.diff - b.diff || a.days - b.days)
      .slice(0, 12)
      .map(x => x.e.id);
    if (rowsTaken.has(i)) return;
    open.forEach(e => {
      if (bankSign(e, ids) !== sign) return;
      if (!amountFits(amount, e.amount, isEstimate(data, e))) return;
      const days = Math.abs(daysBetween(e.date, p.row.date));
      if (days <= PLAN_WINDOW_DAYS) planPairs.push({ row: i, entry: e, days, diff: Math.abs(e.amount - amount) });
    });
  });
  pairUp(planPairs, rowsTaken, entriesTaken, (p) => {
    const prop = proposals[p.row];
    prop.action = 'match';
    prop.entryId = p.entry.id;
    if (!prop.options.includes(p.entry.id)) prop.options.unshift(p.entry.id);
  });

  // 4. What is left is new. Before the tracking start it is history the
  // balances do not count, and a date after today means the dates were
  // read the wrong way round (day and month): both are left out unless the
  // person adds them.
  proposals.forEach((p, i) => {
    p.future = !!(today && p.row.date > today);
    if (!rowsTaken.has(i) && (p.beforeStart || p.future)) p.action = 'skip';
  });
  return proposals;
}

export function countActions(proposals) {
  const counts = { match: 0, recorded: 0, new: 0, skip: 0 };
  proposals.forEach(p => { counts[p.action] = (counts[p.action] || 0) + 1; });
  return counts;
}

// The changes the proposals make: entries to add and patches for existing
// entries. The planned entry keeps its title, category and template link and
// takes the bank's amount and date; the planned date is kept in movedFrom
// so that undoing "done" puts it back where it was planned.
export function buildImportChanges(data, proposals, now = nowIso()) {
  const newEntries = [];
  const updates = [];
  proposals.forEach(p => {
    const row = p.row;
    const amount = Math.abs(row.amount);
    if (p.action === 'match' && p.entryId) {
      const e = (data.entries || []).find(x => x.id === p.entryId && !x.deleted);
      if (!e) return;
      const patch = {
        status: 'done', amount, doneAt: now, date: row.date, importKey: row.key,
        movedFrom: e.date !== row.date ? (e.movedFrom || e.date) : (e.movedFrom || null)
      };
      if (e.type !== 'transfer' && p.categoryId !== undefined && p.categoryId !== e.categoryId && p.categoryTouched) patch.categoryId = p.categoryId;
      updates.push({ id: e.id, patch });
    } else if (p.action === 'recorded' && p.entryId) {
      // Stamped so that the next import of an overlapping statement knows
      // this row for sure, not only by amount and date.
      const e = (data.entries || []).find(x => x.id === p.entryId && !x.deleted);
      if (e && !e.importKey) updates.push({ id: e.id, patch: { importKey: row.key } });
    } else if (p.action === 'new') {
      newEntries.push(makeEntry({
        date: row.date,
        title: p.title,
        type: row.type,
        amount,
        plannedAmount: amount,
        accountId: p.accountId,
        categoryId: p.categoryId || null,
        status: 'done',
        doneAt: now,
        isQuick: false,
        note: p.note || '',
        importKey: row.key
      }));
    }
  });
  return { newEntries, updates };
}
