// Splitting incoming money across accounts and envelopes.
//
// When income lands, the owner moves money to the accounts that will pay the
// upcoming bills and treats those bills as covered ("reserved"). A reserved
// entry stays in the plan until it is marked done; it only stops counting as
// free money.

import { live, makeEntry, newId, nowIso } from './model.js';
import { accountSummaries, compareEntries } from './ledger.js';
import { addDays } from './dates.js';

// The day before the next planned income after `today`, so the split covers
// exactly the bills that have to be paid from the money that just came in.
export function defaultAllocationEnd(data, today, fallbackDays = 30) {
  const next = live(data.entries)
    .filter(e => e.type === 'income' && e.status === 'planned' && !e.isTransit && e.date > today)
    .sort(compareEntries)[0];
  return next ? addDays(next.date, -1) : addDays(today, fallbackDays);
}

export function allocationCandidates(data, until) {
  const start = data.settings.trackingStart || '0000-01-01';
  return live(data.entries)
    .filter(e => e.type === 'expense' && e.status === 'planned' && !e.isTransit
      && (e.amount || 0) > 0 && e.accountId && e.date <= until && e.date >= start)
    .sort(compareEntries);
}

// Core of both modes. In strict mode bills are covered in date order and
// the first bill that does not fit stops the queue (nothing jumps ahead);
// otherwise every given bill is covered and a shortfall is reported.
function cover(data, sourceAccountId, entries, { budget = null, strict = true } = {}) {
  const summaries = accountSummaries(data);
  const source = summaries.get(sourceAccountId);
  const startAvailable = budget !== null ? budget : Math.max(0, source ? source.ownFree : 0);
  let available = startAvailable;

  // Free money already sitting on a target account is used first.
  const freeLeft = new Map();
  summaries.forEach((s, id) => {
    if (id !== sourceAccountId) freeLeft.set(id, Math.max(0, s.ownFree));
  });

  const lines = new Map();
  const inPlace = [];
  const uncovered = [];
  let stopped = false;

  entries.forEach(e => {
    if (stopped) { uncovered.push(e.id); return; }
    const amount = e.amount || 0;
    const onTarget = e.accountId === sourceAccountId ? 0 : Math.min(freeLeft.get(e.accountId) || 0, amount);
    const needed = amount - onTarget;
    if (strict && available < needed) {
      stopped = true;
      uncovered.push(e.id);
      return;
    }
    available -= needed;
    if (e.accountId === sourceAccountId) {
      inPlace.push(e.id);
      return;
    }
    freeLeft.set(e.accountId, (freeLeft.get(e.accountId) || 0) - onTarget);
    const line = lines.get(e.accountId) || { toAccountId: e.accountId, amount: 0, entryIds: [] };
    line.amount += needed;
    line.entryIds.push(e.id);
    lines.set(e.accountId, line);
  });

  return {
    sourceAccountId,
    lines: [...lines.values()],
    inPlace,
    uncovered,
    available: startAvailable,
    sourceFreeAfter: Math.max(0, available),
    shortfall: Math.max(0, -available)
  };
}

// Proposes a split of the free money on `sourceAccountId` for the bills up
// to `until`.
//
// Result:
//   lines     transfers to make: { toAccountId, amount, entryIds }
//   inPlace   bills paid from the source account itself (no transfer)
//   uncovered bills left without money
//   sourceFreeAfter  free money left on the source account
export function suggestAllocation(data, sourceAccountId, until, { budget = null } = {}) {
  return { ...cover(data, sourceAccountId, allocationCandidates(data, until), { budget, strict: true }), until };
}

// The same for a set of bills picked by hand. Covers all of them and tells
// how much is missing if the source cannot pay for everything.
export function planForSelection(data, sourceAccountId, entryIds, until) {
  const ids = new Set(entryIds);
  const picked = allocationCandidates(data, until).filter(e => ids.has(e.id));
  return { ...cover(data, sourceAccountId, picked, { strict: false }), until };
}

// Turns an (optionally edited) plan into records: done transfers and the
// covered entries switched to "reserved". Returns { newEntries, updates }
// for the store to apply in one step.
export function buildAllocation(plan, day) {
  const allocationId = newId();
  const now = nowIso();
  const newEntries = [];
  const updates = [];

  plan.lines.forEach(line => {
    if (line.amount > 0) {
      newEntries.push(makeEntry({
        date: day,
        title: line.title || '',
        type: 'transfer',
        amount: line.amount,
        accountId: plan.sourceAccountId,
        toAccountId: line.toAccountId,
        status: 'done',
        doneAt: now,
        allocationId
      }));
    }
    line.entryIds.forEach(id => updates.push({ id, status: 'reserved', reservedAt: now, allocationId }));
  });
  plan.inPlace.forEach(id => updates.push({ id, status: 'reserved', reservedAt: now, allocationId }));
  return { allocationId, newEntries, updates };
}
