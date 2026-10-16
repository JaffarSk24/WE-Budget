// Bank statement import (CSV): reading the file, finding its layout and
// turning its rows into plain bank rows { date, amount, description, ... }.
// Pure functions; the dialog lives in src/statement.js, matching to the plan
// in src/import/match.js.

import { parseCsv } from './csv.js';
import { parseMoney } from '../money.js';
import { isDayKey } from '../dates.js';
import { normalizeText } from '../rules.js';

// UTF-8 first. Slovak and Czech banks still export windows-1250: decoded as
// UTF-8 such a file shows replacement characters, so it is read again.
export function decodeStatement(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = new TextDecoder('utf-8').decode(view);
  let encoding = 'utf-8';
  if (text.includes('�')) {
    try {
      text = new TextDecoder('windows-1250').decode(view);
      encoding = 'windows-1250';
    } catch (e) {
      // A runtime without that encoding keeps the UTF-8 text.
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, encoding };
}

const DELIMITERS = [',', ';', '\t'];

// The delimiter that splits the first lines into the same number of
// columns most often (more columns win a tie).
export function detectDelimiter(text) {
  const sample = String(text || '').split(/\r?\n/).filter(l => l.trim()).slice(0, 20).join('\n');
  let best = ',';
  let bestScore = 0;
  DELIMITERS.forEach(d => {
    const counts = parseCsv(sample, d).map(r => r.length).filter(n => n > 1);
    if (!counts.length) return;
    const freq = new Map();
    counts.forEach(n => freq.set(n, (freq.get(n) || 0) + 1));
    const [cols, times] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = times * 100 + cols;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  });
  return best;
}

const DATE_LIKE = /^\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4})/;

function looksLikeAmount(cell) {
  return /\d/.test(cell) && parseBankAmount(cell) !== null;
}

// Some banks put the account number, the period and an empty line above
// the table. The header is the first row of text cells (no dates, no
// amounts) followed by a row with a date in it.
export function detectHeaderRow(rows) {
  const limit = Math.min(rows.length - 1, 30);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].map(c => String(c).trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (cells.some(c => DATE_LIKE.test(c) || looksLikeAmount(c))) continue;
    const next = rows[i + 1] || [];
    if (next.some(c => DATE_LIKE.test(String(c)))) return i;
  }
  return 0;
}

// ---------- column layouts ----------

export const MAPPING_FIELDS = ['date', 'amount', 'debit', 'credit', 'fee', 'description', 'counterparty', 'note', 'balance', 'state'];

// Header names seen in public statement layouts, compared without case and
// diacritics. The first name found wins, so the more specific come first.
const NAMES = {
  date: ['completed date', 'booking date', 'transaction date', 'posting date', 'date', 'datum zauctovania', 'datum zauctovani', 'datum transakcie', 'datum transakce', 'datum', 'value date', 'started date'],
  amount: ['amount', 'suma', 'ciastka', 'castka', 'objem', 'betrag', 'value'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'paid out', 'money out', 'out', 'vydaj', 'vydavky', 'odchozi', 'odchadzajuce'],
  credit: ['credit', 'deposit', 'deposits', 'paid in', 'money in', 'in', 'prijem', 'prijmy', 'prichozi', 'prichadzajuce'],
  fee: ['fee', 'fees', 'poplatok', 'poplatek'],
  description: ['description', 'details', 'merchant', 'popis', 'popis transakcie', 'popis transakce', 'text', 'transaction details', 'name'],
  counterparty: ['counterparty', 'payee', 'beneficiary', 'recipient', 'protistrana', 'nazov protiuctu', 'nazev protiuctu', 'protiucet nazov', 'nazov uctu protistrany'],
  note: ['note', 'notes', 'reference', 'message', 'poznamka', 'sprava pre prijemcu', 'zprava pro prijemce', 'informacia pre prijemcu'],
  balance: ['balance', 'running balance', 'zostatok', 'zustatek', 'saldo'],
  state: ['state', 'status', 'stav']
};

function findColumn(header, names, taken) {
  const norm = header.map(normalizeText);
  for (const name of names) {
    const i = norm.findIndex((h, idx) => h === name && !taken.has(idx));
    if (i !== -1) return i;
  }
  return -1;
}

export function emptyMapping() {
  return Object.fromEntries(MAPPING_FIELDS.map(f => [f, -1]));
}

// Guesses a mapping from the header names. Presets come from public
// column layouts: Revolut (state, fee, completed date), one signed amount
// column, or separate debit and credit columns. Returns { preset, mapping }.
export function detectPreset(header) {
  const norm = header.map(normalizeText);
  const has = (name) => norm.includes(name);
  const mapping = emptyMapping();
  const taken = new Set();
  const take = (field, names) => {
    const i = findColumn(header, names, taken);
    if (i !== -1) {
      mapping[field] = i;
      taken.add(i);
    }
  };
  if (['type', 'product', 'started date', 'completed date', 'description', 'amount', 'fee', 'state'].every(has)) {
    take('date', ['completed date']);
    take('amount', ['amount']);
    take('fee', ['fee']);
    take('description', ['description']);
    take('state', ['state']);
    take('balance', ['balance']);
    // The start date stands in when a row has no completion date.
    mapping.fallbackDate = findColumn(header, ['started date'], new Set());
    return { preset: 'revolut', mapping };
  }
  take('date', NAMES.date);
  take('amount', NAMES.amount);
  if (mapping.amount === -1) {
    take('debit', NAMES.debit);
    take('credit', NAMES.credit);
  }
  take('fee', NAMES.fee);
  take('counterparty', NAMES.counterparty);
  take('description', NAMES.description);
  take('note', NAMES.note);
  take('balance', NAMES.balance);
  take('state', NAMES.state);
  if (mapping.amount === -1 && mapping.debit !== -1 && mapping.credit !== -1) return { preset: 'debitCredit', mapping };
  if (mapping.amount !== -1) return { preset: 'signed', mapping };
  return { preset: 'custom', mapping };
}

// A saved mapping keeps header names; this turns it back into column
// indexes for the current file. Null when a needed column is missing.
export function mappingFromNames(header, saved) {
  if (!saved || !saved.columns) return null;
  const mapping = emptyMapping();
  const taken = new Set();
  for (const field of MAPPING_FIELDS) {
    const name = saved.columns[field];
    if (!name) continue;
    const i = findColumn(header, [normalizeText(name)], taken);
    if (i === -1) return null;
    mapping[field] = i;
    taken.add(i);
  }
  if (saved.columns.fallbackDate) mapping.fallbackDate = findColumn(header, [normalizeText(saved.columns.fallbackDate)], new Set());
  return mappingComplete(mapping) ? mapping : null;
}

export function mappingToNames(header, mapping) {
  const columns = {};
  [...MAPPING_FIELDS, 'fallbackDate'].forEach(field => {
    const i = mapping[field];
    if (i !== undefined && i !== -1 && header[i] !== undefined) columns[field] = header[i];
  });
  return columns;
}

export function mappingComplete(mapping) {
  return mapping.date !== -1 && (mapping.amount !== -1 || mapping.debit !== -1 || mapping.credit !== -1);
}

// ---------- dates ----------

const pad = (n) => String(n).padStart(2, '0');

function splitDate(value) {
  const s = String(value ?? '').trim();
  // A time after the date ('2026-03-12 14:32:05', '2026-03-12T14:32') is
  // dropped: entries are kept by day.
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[T\s])/);
  if (m) return { kind: 'ymd', a: Number(m[1]), b: Number(m[2]), c: Number(m[3]) };
  m = s.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2}|\d{4})(?:$|[\s,T])/);
  if (m) return { kind: 'dot', a: Number(m[1]), b: Number(m[2]), c: Number(m[3]) };
  m = s.match(/^(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})(?:$|[\s,T])/);
  if (m) return { kind: m[2] === '/' ? 'slash' : 'dash', a: Number(m[1]), b: Number(m[3]), c: Number(m[4]) };
  return null;
}

function key(y, m, d) {
  const year = y < 100 ? 2000 + y : y;
  const k = `${year}-${pad(m)}-${pad(d)}`;
  return isDayKey(k) ? k : null;
}

// 'dmy' or 'mdy' decides only between the two readings of 03/04/2026;
// dotted dates are always day first, ISO dates year first.
export function parseBankDate(value, order = 'dmy') {
  const p = splitDate(value);
  if (!p) return null;
  if (p.kind === 'ymd') return key(p.a, p.b, p.c);
  if (p.kind === 'slash' && order === 'mdy') return key(p.c, p.a, p.b);
  return key(p.c, p.b, p.a);
}

// Day first or month first, from the values themselves: a first number
// above 12 means day first, a second one above 12 means month first.
// 'ambiguous' when slash dates never tell (the person is asked).
export function detectDateOrder(values) {
  let slash = false;
  let dmy = false;
  let mdy = false;
  values.forEach(v => {
    const p = splitDate(v);
    if (!p || p.kind !== 'slash') return;
    slash = true;
    if (p.a > 12) dmy = true;
    if (p.b > 12) mdy = true;
  });
  if (!slash) return 'dmy';
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return 'ambiguous';
}

// ---------- amounts ----------

// '-1 234,56', '1.234,56', '(12.50)', '12,50-', '−8.00 EUR', "1'234.50" ->
// signed cents, or null.
export function parseBankAmount(value) {
  let s = String(value ?? '').trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/\u2212/g, '-').replace(/[\s'\u00a0\u202f]/g, '');
  // Currency codes and symbols around the number.
  s = s.replace(/^[^\d+\-.,]+/, '').replace(/[^\d.,+-]+$/, '');
  if (/^\d[\d.,]*-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (!/^[+-]?[\d.,]*\d[\d.,]*$/.test(s)) return null;
  const cents = parseMoney(s);
  if (cents === null) return null;
  return negative ? -Math.abs(cents) : cents;
}

// ---------- rows ----------

const cell = (row, i) => (i === undefined || i === -1 ? '' : String(row[i] ?? '').trim());

// Turns the table under the header into bank rows. Rows without a date or
// an amount, zero amounts and (with a state column) unfinished payments are
// left out and counted. A fee is taken off the amount: Revolut lists a
// card payment of -10.00 with a fee of 0.50 as one -10.50 on the account.
export function normalizeRows(table, headerIndex, mapping, { dateOrder = 'dmy' } = {}) {
  const rows = [];
  let invalid = 0;
  let pending = 0;
  table.slice(headerIndex + 1).forEach((row, i) => {
    if (!row.some(c => String(c).trim())) return;
    if (mapping.state !== -1) {
      const state = normalizeText(cell(row, mapping.state));
      if (state && !['completed', 'booked', 'zauctovane', 'zauctovano', 'done', 'settled'].includes(state)) {
        pending++;
        return;
      }
    }
    const date = parseBankDate(cell(row, mapping.date), dateOrder) || parseBankDate(cell(row, mapping.fallbackDate), dateOrder);
    let amount = null;
    if (mapping.amount !== -1) {
      amount = parseBankAmount(cell(row, mapping.amount));
    } else {
      const debit = parseBankAmount(cell(row, mapping.debit));
      const credit = parseBankAmount(cell(row, mapping.credit));
      if (debit !== null || credit !== null) amount = Math.abs(credit || 0) - Math.abs(debit || 0);
    }
    const fee = parseBankAmount(cell(row, mapping.fee));
    if (amount !== null && fee) amount -= Math.abs(fee);
    if (!date || amount === null) {
      invalid++;
      return;
    }
    if (amount === 0) return;
    const description = cell(row, mapping.description);
    const counterparty = cell(row, mapping.counterparty);
    rows.push({
      line: headerIndex + 2 + i,
      date,
      amount,
      type: amount < 0 ? 'expense' : 'income',
      description: description || counterparty,
      counterparty: description ? counterparty : '',
      note: cell(row, mapping.note),
      balance: mapping.balance === -1 ? null : parseBankAmount(cell(row, mapping.balance))
    });
  });
  return { rows, invalid, pending };
}

// The balance after the statement's last payment. Statements come newest
// first or oldest first; the date order of the rows tells which.
export function lastBalance(rows) {
  const withBalance = rows.filter(r => r.balance !== null && r.balance !== undefined);
  if (!withBalance.length) return null;
  const first = withBalance[0];
  const last = withBalance[withBalance.length - 1];
  const newestFirst = first.date > last.date;
  const row = newestFirst ? first : last;
  return { date: row.date, balance: row.balance };
}

// ---------- import keys ----------

// FNV-1a, twice with different seeds: 16 hex characters, enough to tell
// the rows of a few years of statements apart.
function fnv(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function importKey(accountId, row, n = 0) {
  const text = `${accountId}|${row.date}|${row.amount}|${normalizeText(row.description)}|${n}`;
  return fnv(text, 2166136261) + fnv(text, 33554467);
}

// Two identical rows in one file (two coffees of the same price on the same
// day) get different keys through a counter, in file order, so importing
// the same file again finds both.
export function withImportKeys(accountId, rows) {
  const seen = new Map();
  return rows.map(r => {
    const base = importKey(accountId, r, 0);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return { ...r, key: n ? importKey(accountId, r, n) : base };
  });
}

// Everything from file text to bank rows, with what was guessed on the way.
export function readStatement(text, { mapping = null, dateOrder = null } = {}) {
  const delimiter = detectDelimiter(text);
  const table = parseCsv(text, delimiter);
  const headerIndex = detectHeaderRow(table);
  const header = (table[headerIndex] || []).map(c => String(c).trim());
  const detected = detectPreset(header);
  const used = mapping || detected.mapping;
  const dates = table.slice(headerIndex + 1).map(r => cell(r, used.date));
  const detectedOrder = detectDateOrder(dates);
  const order = dateOrder || (detectedOrder === 'ambiguous' ? 'dmy' : detectedOrder);
  const result = mappingComplete(used) ? normalizeRows(table, headerIndex, used, { dateOrder: order }) : { rows: [], invalid: 0, pending: 0 };
  return {
    delimiter, table, headerIndex, header, preset: mapping ? 'saved' : detected.preset,
    mapping: used, dateOrder: order, dateAmbiguous: detectedOrder === 'ambiguous', ...result
  };
}
