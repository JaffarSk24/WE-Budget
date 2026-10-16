// Net worth: what the household owns minus what it owes, on any day and
// month by month. Pure functions over the data document, amounts in cents.
// Account balances come from the ledger, debt amounts from debtState, so
// this file adds nothing new about money, it only puts the parts together.

import { live } from './model.js';
import { accountSummaries } from './ledger.js';
import { debtState } from './debts.js';
import { addDays, addMonthsToMonth, firstDayOfMonth, lastDayOfMonth, monthOf } from './dates.js';

export const NET_WORTH_GROUPS = ['accounts', 'assets', 'owedToMe', 'debts'];

// The value of an asset on a day: the latest value on or before it, or null
// when nothing was known yet.
export function assetValueAt(asset, day) {
  let found = null;
  (asset.values || []).forEach(v => {
    if (v.date <= day && (!found || v.date >= found.date)) found = v;
  });
  return found ? found.amount || 0 : null;
}

// The latest value of an asset, for the list on the Accounts screen.
export function latestAssetValue(asset) {
  const values = asset.values || [];
  if (!values.length) return null;
  return values.reduce((a, b) => (b.date >= a.date ? b : a));
}

// An asset counts on a day once it has a value, until the day it was
// archived (sold, given up): the past stays as it was.
function assetCounts(asset, day) {
  if (asset.archived && (!asset.archivedAt || asset.archivedAt <= day)) return false;
  return assetValueAt(asset, day) !== null;
}

// Money that belongs to others and is passing through the accounts: done
// transit income in minus transit payments out. Positive when the money is
// still on the account, negative when it was paid out ahead and is to come
// back (then it is really owed to me, so it stays in net worth).
export function transitHeld(data, day) {
  const start = data.settings.trackingStart || '0000-01-01';
  return live(data.entries).reduce((sum, e) => {
    if (!e.isTransit || e.status !== 'done' || e.date < start || e.date > day) return sum;
    if (e.type === 'income') return sum + (e.amount || 0);
    if (e.type === 'expense') return sum - (e.amount || 0);
    return sum;
  }, 0);
}

// A debt is known from its checkpoint (balanceDate) on: before that day it
// was not taken yet, or nothing is known about it. Archived debts are left
// out like archived goals.
function debtCounts(debt, day) {
  return !debt.archived && (!debt.balanceDate || debt.balanceDate <= day);
}

// Net worth at the end of `day`. Every account counts once with its own
// balance (an envelope's money is not added to its account a second time),
// archived accounts too, since their money (usually none) is still there.
export function netWorthAt(data, day) {
  const summaries = accountSummaries(data, day);
  let balances = 0;
  live(data.accounts).forEach(a => { balances += summaries.get(a.id)?.ownBalance || 0; });
  const transit = transitHeld(data, day);
  const accounts = balances - transit;

  const assetItems = live(data.assets || [])
    .filter(a => assetCounts(a, day))
    .map(a => ({ id: a.id, name: a.name, kind: a.kind, amount: assetValueAt(a, day) }));
  const assets = assetItems.reduce((s, a) => s + a.amount, 0);

  let owedToMe = 0;
  let debts = 0;
  live(data.debts || []).forEach(d => {
    if (!debtCounts(d, day)) return;
    const { remaining } = debtState(data, d, day);
    if (d.kind === 'owed') owedToMe += remaining;
    else debts += remaining;
  });

  return {
    day,
    total: accounts + assets + owedToMe - debts,
    accounts, transit, assets, owedToMe, debts,
    assetItems,
    groups: [
      { key: 'accounts', amount: accounts },
      { key: 'assets', amount: assets },
      { key: 'owedToMe', amount: owedToMe },
      { key: 'debts', amount: -debts }
    ]
  };
}

// Net worth at the end of each of the last `months` months (the month in
// progress counts up to today), never before the tracking start: balances
// are not known before it. `start` is the value just before the first
// month (or at the tracking start), so `change` covers the whole period.
export function netWorthHistory(data, today, months = 12) {
  const n = Math.max(1, Math.floor(months) || 1);
  const tracking = data.settings.trackingStart || null;
  const thisMonth = monthOf(today);
  const points = [];
  for (let i = n - 1; i >= 0; i--) {
    const month = addMonthsToMonth(thisMonth, -i);
    const day = i === 0 ? today : lastDayOfMonth(month);
    if (tracking && day < tracking) continue;
    points.push({ month, ...netWorthAt(data, day) });
  }
  const firstMonth = points.length ? points[0].month : thisMonth;
  let baseDay = addDays(firstDayOfMonth(firstMonth), -1);
  if (tracking && baseDay < tracking) baseDay = tracking;
  if (baseDay > today) baseDay = today;
  const start = netWorthAt(data, baseDay).total;
  const end = points.length ? points[points.length - 1].total : start;
  return { points, startDay: baseDay, start, end, change: end - start };
}
