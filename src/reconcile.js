// Manual reconciliation: the owner types what the bank actually shows, the
// difference becomes a visible adjustment entry instead of a silent fix.

import { makeCheck, makeEntry, nowIso } from './model.js';
import { accountSummaries } from './ledger.js';

export function buildReconciliation(data, accountId, actualBalance, day, note = '') {
  const computed = accountSummaries(data, day).get(accountId);
  const computedBalance = computed ? computed.ownBalance : 0;
  const diff = actualBalance - computedBalance;

  let adjustment = null;
  if (diff !== 0) {
    adjustment = makeEntry({
      date: day,
      title: note,
      type: diff > 0 ? 'income' : 'expense',
      amount: Math.abs(diff),
      accountId,
      status: 'done',
      doneAt: nowIso(),
      isAdjustment: true
    });
  }
  const check = makeCheck({
    accountId,
    date: day,
    actualBalance,
    computedBalance,
    adjustmentEntryId: adjustment ? adjustment.id : null,
    note
  });
  return { diff, adjustment, check };
}
