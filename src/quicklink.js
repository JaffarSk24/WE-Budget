// Quick entry from a link: the web app opens the quick entry dialog filled
// in when its address carries ?quick=expense|income and optionally amount,
// note, category and account. This is what an iPhone Shortcut, Siri or a
// Wallet "Transaction" automation opens after a card payment.

import { live } from './model.js';
import { parseMoney } from './money.js';

export const QUICK_PARAMS = ['quick', 'amount', 'note', 'category', 'account'];
const NOTE_MAX = 200;

function sameName(a, b) {
  return String(a || '').trim().toLocaleLowerCase() === String(b || '').trim().toLocaleLowerCase();
}

// Wallet passes the amount with its currency ("€12.50", "12,50 EUR"); the
// sign comes from `quick`, so only a positive amount is taken.
export function parseLinkAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[A-Za-z]{3}/g, '').trim();
  const cents = parseMoney(cleaned);
  return cents !== null && cents > 0 ? cents : null;
}

// The query string of the address -> initial values of the quick entry
// dialog, or null when the address does not ask for it. Category and
// account are matched by name, ignoring case; a name that matches nothing
// is ignored. A bad amount leaves the amount empty.
export function parseQuickLink(search, data) {
  let params;
  try { params = new URLSearchParams(search || ''); } catch (e) { return null; }
  const type = String(params.get('quick') || '').trim().toLowerCase();
  if (type !== 'expense' && type !== 'income') return null;
  const out = { type, amount: parseLinkAmount(params.get('amount')), note: '', categoryId: null, accountId: null };
  const note = params.get('note');
  if (note) out.note = note.trim().slice(0, NOTE_MAX);
  const category = params.get('category');
  if (category && data) {
    const hit = live(data.categories).find(c => c.type === type && !c.archived && sameName(c.name, category));
    if (hit) out.categoryId = hit.id;
  }
  const account = params.get('account');
  if (account && data) {
    const hit = live(data.accounts).find(a => !a.archived && sameName(a.name, account));
    if (hit) out.accountId = hit.id;
  }
  return out;
}

// The same address without the quick entry parameters, so a reload does
// not open the dialog again. Other parameters and the hash stay.
export function stripQuickParams(href) {
  const url = new URL(href);
  QUICK_PARAMS.forEach(p => url.searchParams.delete(p));
  return url.pathname + url.search + url.hash;
}

// The link that opens the quick entry dialog for an expense.
export function quickLinkBase(appUrl, type = 'expense') {
  return `${appUrl}?quick=${type}`;
}
