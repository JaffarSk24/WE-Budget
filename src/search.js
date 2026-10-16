// Search over the entries of the plan. Pure functions: the data comes in,
// the found entries and their totals come out, nothing touches the store
// or the page, so the search screens and the tests share one behaviour.

import { live } from './model.js';

// Lower case without diacritics, so "kava" finds "Káva" and "ЁЛКА" finds
// "елка". NFD splits a letter from its accents, which are then dropped.
// Cyrillic й and ё fold to и and е; the query folds the same way, so a
// search for either spelling finds both.
export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// A query word that looks like an amount: "12,50", "12.50", "12", "12€".
// Returns { cents, whole } where `whole` means no decimals were typed, so
// "12" finds 12.00 as well as 12.50, while "12,50" finds exactly 12.50.
export function parseAmountToken(token) {
  const m = /^(\d+)(?:[.,](\d{1,2}))?[€$£₴₽]?$/.exec(String(token || '').trim());
  if (!m) return null;
  const whole = m[2] === undefined;
  const cents = Number(m[1]) * 100 + (whole ? 0 : Number((m[2] + '0').slice(0, 2)));
  return { cents, whole };
}

function amountMatches(amount, parsed) {
  const abs = Math.abs(amount || 0);
  return parsed.whole ? Math.floor(abs / 100) === parsed.cents / 100 : abs === parsed.cents;
}

export function queryTokens(query) {
  return foldText(query).split(/\s+/).filter(Boolean);
}

// Filters with no value set do not narrow anything.
export function hasActiveFilters(filters = {}) {
  const f = filters || {};
  return Boolean(f.from || f.to || f.type || f.accountId || f.categoryId || f.status || f.quickOnly);
}

// Newest first; inside one day the latest created comes first.
export function compareNewestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ca = a.createdAt || '';
  const cb = b.createdAt || '';
  if (ca !== cb) return ca < cb ? 1 : -1;
  return 0;
}

// Text of everything the query may hit, folded once per entry.
function haystack(entry, accountNames, categoryNames) {
  return foldText([
    entry.title,
    entry.note,
    categoryNames.get(entry.categoryId),
    accountNames.get(entry.accountId),
    accountNames.get(entry.toAccountId)
  ].filter(Boolean).join('\n'));
}

// filters: { from, to (day keys, inclusive), type, accountId, categoryId,
// status, quickOnly }. An envelope belongs to its account: filtering by the
// account also finds what was paid from or to its envelopes.
// Totals leave cancelled entries out: they never move any money.
export function searchEntries(data, query = '', filters = {}) {
  const f = filters || {};
  const accounts = live(data && data.accounts);
  const parentOf = new Map(accounts.map(a => [a.id, a.parentId || null]));
  // An envelope is named with its account, so "Bank" finds the envelope's
  // payments too, and the envelope's own name finds them as well.
  const byId = new Map(accounts.map(a => [a.id, a]));
  const accountNames = new Map(accounts.map(a => {
    const parent = a.parentId ? byId.get(a.parentId) : null;
    return [a.id, parent ? `${parent.name} ${a.name}` : a.name];
  }));
  const categoryNames = new Map(live(data && data.categories).map(c => [c.id, c.name]));

  const inAccount = (id) => Boolean(id) && (id === f.accountId || parentOf.get(id) === f.accountId);
  const tokens = queryTokens(query).map(word => ({ word, amount: parseAmountToken(word) }));

  const results = live(data && data.entries).filter(e => {
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.type && e.type !== f.type) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.categoryId && e.categoryId !== f.categoryId) return false;
    if (f.quickOnly && !e.isQuick) return false;
    if (f.accountId && !inAccount(e.accountId) && !inAccount(e.toAccountId)) return false;
    if (!tokens.length) return true;
    const text = haystack(e, accountNames, categoryNames);
    // Every word has to be found somewhere: in the text or as the amount.
    return tokens.every(tk => text.includes(tk.word) || (tk.amount !== null && amountMatches(e.amount, tk.amount)));
  }).sort(compareNewestFirst);

  let expense = 0;
  let income = 0;
  results.forEach(e => {
    if (e.status === 'cancelled') return;
    if (e.type === 'expense') expense += e.amount || 0;
    else if (e.type === 'income') income += e.amount || 0;
  });
  return { results, count: results.length, expense, income };
}
