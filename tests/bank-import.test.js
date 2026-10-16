import { describe, it, expect } from 'vitest';
import {
  decodeStatement, detectDelimiter, detectHeaderRow, detectPreset, parseBankDate, detectDateOrder,
  parseBankAmount, readStatement, withImportKeys, lastBalance, mappingFromNames, mappingToNames
} from '../src/import/bank.js';
import { matchStatement, buildImportChanges, countActions, amountFits } from '../src/import/match.js';
import { parseCsv } from '../src/import/csv.js';
import { emptyData, makeAccount, makeEntry, makeRule, makeTemplate } from '../src/model.js';

// All statements below are made up; only the column layouts are the banks' public ones.
const REVOLUT = [
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
  'CARD_PAYMENT,Current,2026-03-02 10:14:22,2026-03-03 09:01:10,Coffee Corner,-3.50,0.00,EUR,COMPLETED,996.50',
  'TOPUP,Current,2026-03-04 08:00:00,,Top-up by *1234,100.00,0.00,EUR,PENDING,',
  'CARD_PAYMENT,Current,2026-03-05 18:30:00,2026-03-06 07:12:00,Example Shop,-20.00,0.50,EUR,COMPLETED,976.00',
  'TRANSFER,Current,2026-03-07 12:00:00,2026-03-07 12:00:01,Payment from Example Ltd,1500.00,0.00,EUR,COMPLETED,2476.00'
].join('\n');

const SIGNED = [
  'Account statement;SK00 0000 0000 0000 0000 0000',
  'Period;01.03.2026 - 31.03.2026',
  '',
  'Dátum;Suma;Popis;Názov protiúčtu;Poznámka;Zostatok',
  '12.03.2026;-1 234,56;PLATBA KARTOU Potraviny Žilina;;;8 765,44',
  '13.3.2026 14:02;2.500,00;Mzda;Example s.r.o.;Výplata marec;11 265,44',
  '14.03.2026;(12,00);Poplatok za vedenie;;;11 253,44'
].join('\r\n');

const DEBIT_CREDIT = [
  'Date\tDescription\tPaid out\tPaid in\tBalance',
  '03/15/2026\tCOFFEE CORNER 4532 **** 1234\t4.20\t\t1,995.80',
  '03/16/2026\tSalary Example Ltd\t\t2,000.00\t3,995.80',
  '03/17/2026\tCity Gym\t35.00\t\t3,960.80'
].join('\n');

const encode = (text) => new TextEncoder().encode(text);

// windows-1250 bytes for the letters the samples use.
function cp1250(text) {
  const map = { 'á': 0xe1, 'ú': 0xfa, 'ž': 0x9e, 'Ž': 0x8e, 'ý': 0xfd, 'ó': 0xf3, 'č': 0xe8 };
  return new Uint8Array([...text].map(ch => map[ch] ?? ch.charCodeAt(0)));
}

describe('reading a statement', () => {
  it('decodes UTF-8 and falls back to windows-1250', () => {
    expect(decodeStatement(encode('\ufeffDátum;Suma')).text).toBe('Dátum;Suma');
    const old = decodeStatement(cp1250('Dátum;Suma;Názov protiúčtu;Žilina'));
    expect(old.encoding).toBe('windows-1250');
    expect(old.text).toBe('Dátum;Suma;Názov protiúčtu;Žilina');
  });

  it('detects the delimiter and the header row', () => {
    expect(detectDelimiter(REVOLUT)).toBe(',');
    expect(detectDelimiter(SIGNED)).toBe(';');
    expect(detectDelimiter(DEBIT_CREDIT)).toBe('\t');
    expect(detectHeaderRow(parseCsv(SIGNED, ';'))).toBe(3);
    expect(detectHeaderRow(parseCsv(REVOLUT, ','))).toBe(0);
  });

  it('parses dates in the usual formats', () => {
    expect(parseBankDate('12.03.2026')).toBe('2026-03-12');
    expect(parseBankDate('2.3.2026')).toBe('2026-03-02');
    expect(parseBankDate('2. 3. 2026')).toBe('2026-03-02');
    expect(parseBankDate('2026-03-12 14:32:05')).toBe('2026-03-12');
    expect(parseBankDate('2026-03-12T14:32')).toBe('2026-03-12');
    expect(parseBankDate('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(parseBankDate('03/04/2026', 'mdy')).toBe('2026-03-04');
    expect(parseBankDate('31/02/2026')).toBe(null);
    expect(parseBankDate('12.03.26')).toBe('2026-03-12');
    expect(parseBankDate('Total')).toBe(null);
  });

  it('tells day-first from month-first, or says it cannot', () => {
    expect(detectDateOrder(['15/03/2026', '01/04/2026'])).toBe('dmy');
    expect(detectDateOrder(['03/15/2026', '04/01/2026'])).toBe('mdy');
    expect(detectDateOrder(['03/04/2026', '05/06/2026'])).toBe('ambiguous');
    expect(detectDateOrder(['12.03.2026'])).toBe('dmy');
    const r = readStatement('Date,Amount,Description\n03/04/2026,-5.00,A\n05/06/2026,-6.00,B');
    expect(r.dateAmbiguous).toBe(true);
    expect(readStatement('Date,Amount,Description\n03/04/2026,-5.00,A', { dateOrder: 'mdy' }).rows[0].date).toBe('2026-03-04');
  });

  it('parses amounts with any separators and signs', () => {
    expect(parseBankAmount('-1 234,56')).toBe(-123456);
    expect(parseBankAmount('1.234,56')).toBe(123456);
    expect(parseBankAmount('1,234.56')).toBe(123456);
    expect(parseBankAmount('(12.50)')).toBe(-1250);
    expect(parseBankAmount('12,50-')).toBe(-1250);
    expect(parseBankAmount('\u22128.00 EUR')).toBe(-800);
    expect(parseBankAmount("1'234.50")).toBe(123450);
    expect(parseBankAmount('+3.5')).toBe(350);
    expect(parseBankAmount('')).toBe(null);
    expect(parseBankAmount('n/a')).toBe(null);
  });

  it('reads a Revolut statement: completed rows only, the fee taken off', () => {
    const r = readStatement(REVOLUT);
    expect(r.preset).toBe('revolut');
    expect(r.pending).toBe(1);
    expect(r.rows.map(x => [x.date, x.amount, x.description])).toEqual([
      ['2026-03-03', -350, 'Coffee Corner'],
      ['2026-03-06', -2050, 'Example Shop'],
      ['2026-03-07', 150000, 'Payment from Example Ltd']
    ]);
    expect(lastBalance(r.rows)).toEqual({ date: '2026-03-07', balance: 247600 });
  });

  it('reads a signed amount statement with a preamble', () => {
    const r = readStatement(decodeStatement(encode(SIGNED)).text);
    expect(r.preset).toBe('signed');
    expect(r.rows.map(x => [x.date, x.amount, x.type])).toEqual([
      ['2026-03-12', -123456, 'expense'], ['2026-03-13', 250000, 'income'], ['2026-03-14', -1200, 'expense']
    ]);
    expect(r.rows[1]).toMatchObject({ description: 'Mzda', counterparty: 'Example s.r.o.', note: 'Výplata marec' });
    expect(lastBalance(r.rows).balance).toBe(1125344);
  });

  it('reads separate debit and credit columns', () => {
    const r = readStatement(DEBIT_CREDIT);
    expect(r.preset).toBe('debitCredit');
    expect(r.dateOrder).toBe('mdy');
    expect(r.rows.map(x => [x.date, x.amount])).toEqual([['2026-03-15', -420], ['2026-03-16', 200000], ['2026-03-17', -3500]]);
    expect(lastBalance(r.rows).balance).toBe(396080);
  });

  it('newest-first statements take the balance of the first row', () => {
    expect(lastBalance([{ date: '2026-03-09', balance: 10 }, { date: '2026-03-01', balance: 5 }])).toEqual({ date: '2026-03-09', balance: 10 });
    expect(lastBalance([{ date: '2026-03-09', balance: null }])).toBe(null);
  });

  it('keeps a mapping by header names', () => {
    const header = ['Datum', 'Text', 'Amount'];
    const { mapping } = detectPreset(header);
    const names = mappingToNames(header, mapping);
    expect(names).toEqual({ date: 'Datum', description: 'Text', amount: 'Amount' });
    expect(mappingFromNames(['Amount', 'Datum', 'Text'], { columns: names })).toMatchObject({ date: 1, amount: 0, description: 2 });
    expect(mappingFromNames(['Datum', 'Text'], { columns: names })).toBe(null);
  });

  it('gives identical rows in one file different keys', () => {
    const rows = withImportKeys('acc', [
      { date: '2026-03-01', amount: -350, description: 'Coffee' },
      { date: '2026-03-01', amount: -350, description: 'COFFEE' },
      { date: '2026-03-01', amount: -350, description: 'Tea' }
    ]);
    expect(new Set(rows.map(r => r.key)).size).toBe(3);
    expect(withImportKeys('acc', rows)[1].key).toBe(rows[1].key);
    expect(withImportKeys('other', rows)[0].key).not.toBe(rows[0].key);
  });
});

function budget() {
  const data = emptyData();
  data.settings.trackingStart = '2026-01-01';
  const main = makeAccount({ name: 'Everyday' });
  const bills = makeAccount({ name: 'Bills', parentId: main.id });
  const savings = makeAccount({ name: 'Savings' });
  data.accounts.push(main, bills, savings);
  const power = makeTemplate({ title: 'Electricity', amount: 11500, amountIsEstimate: true, accountId: bills.id });
  data.templates.push(power);
  return { data, main, bills, savings, power };
}

const row = (date, amount, description = 'Bank text', extra = {}) => ({
  date, amount, description, counterparty: '', note: '', balance: null, type: amount < 0 ? 'expense' : 'income', ...extra
});

describe('matching a statement to the plan', () => {
  it('matches planned and reserved entries on the account and its envelopes, closest date first', () => {
    const { data, main, bills } = budget();
    const rent = makeEntry({ date: '2026-03-01', title: 'Rent', amount: 95000, accountId: bills.id, categoryId: 'housing' });
    const rentNext = makeEntry({ date: '2026-04-01', title: 'Rent', amount: 95000, accountId: bills.id });
    const gym = makeEntry({ date: '2026-03-10', title: 'Gym', amount: 3500, accountId: main.id, status: 'reserved' });
    const gymFar = makeEntry({ date: '2026-03-03', title: 'Gym', amount: 3500, accountId: main.id });
    data.entries.push(rent, rentNext, gym, gymFar);
    const rows = withImportKeys(main.id, [row('2026-03-03', -95000, 'Landlord'), row('2026-03-12', -3500, 'City Gym')]);
    const p = matchStatement(data, main.id, rows, '2026-03-20');
    expect(p.map(x => [x.action, x.entryId])).toEqual([['match', rent.id], ['match', gym.id]]);
    expect(p[1].options).toContain(gymFar.id);

    const { newEntries, updates } = buildImportChanges(data, p, 'now');
    expect(newEntries).toEqual([]);
    const rentPatch = updates.find(u => u.id === rent.id).patch;
    expect(rentPatch).toMatchObject({ status: 'done', amount: 95000, date: '2026-03-03', movedFrom: '2026-03-01', importKey: rows[0].key });
    expect(rentPatch.categoryId).toBeUndefined();
  });

  it('uses one entry once', () => {
    const { data, main } = budget();
    const coffee = makeEntry({ date: '2026-03-05', amount: 350, accountId: main.id });
    data.entries.push(coffee);
    const rows = withImportKeys(main.id, [row('2026-03-04', -350), row('2026-03-05', -350)]);
    const p = matchStatement(data, main.id, rows, '2026-03-20');
    expect(p.map(x => x.action)).toEqual(['new', 'match']);
    expect(p[1].entryId).toBe(coffee.id);
  });

  it('matches an estimated amount within 10 percent', () => {
    const { data, main, bills, power } = budget();
    const planned = makeEntry({ date: '2026-03-15', title: 'Electricity', amount: 11500, accountId: bills.id, templateId: power.id });
    const fixed = makeEntry({ date: '2026-03-15', title: 'Phone', amount: 2500, accountId: bills.id });
    data.entries.push(planned, fixed);
    expect(amountFits(12300, 11500, true)).toBe(true);
    expect(amountFits(13000, 11500, true)).toBe(false);
    const rows = withImportKeys(main.id, [row('2026-03-16', -12300), row('2026-03-16', -2600)]);
    const p = matchStatement(data, main.id, rows, '2026-03-20');
    expect(p.map(x => x.action)).toEqual(['match', 'new']);
    expect(buildImportChanges(data, p, 'now').updates[0].patch.amount).toBe(12300);
  });

  it('ignores other accounts, other directions and transfers inside the account', () => {
    const { data, main, bills, savings } = budget();
    data.entries.push(
      makeEntry({ date: '2026-03-05', amount: 5000, accountId: savings.id }),
      makeEntry({ date: '2026-03-05', amount: 5000, accountId: main.id, type: 'income' }),
      makeEntry({ date: '2026-03-05', amount: 5000, accountId: main.id, toAccountId: bills.id, type: 'transfer' }));
    const out = makeEntry({ date: '2026-03-05', amount: 5000, accountId: main.id, toAccountId: savings.id, type: 'transfer' });
    data.entries.push(out);
    const p = matchStatement(data, main.id, withImportKeys(main.id, [row('2026-03-05', -5000)]), '2026-03-20');
    expect(p[0]).toMatchObject({ action: 'match', entryId: out.id });
  });

  it('knows payments already marked done', () => {
    const { data, main } = budget();
    const done = makeEntry({ date: '2026-03-04', amount: 4200, accountId: main.id, status: 'done' });
    data.entries.push(done);
    const p = matchStatement(data, main.id, withImportKeys(main.id, [row('2026-03-06', -4200), row('2026-03-09', -4200)]), '2026-03-20');
    expect(p.map(x => x.action)).toEqual(['recorded', 'new']);
    expect(countActions(p)).toEqual({ match: 0, recorded: 1, new: 1, skip: 0 });
  });

  it('proposes new entries with the rule category and title', () => {
    const { data, main } = budget();
    data.rules.push(makeRule({ text: 'lidl', categoryId: 'food', title: 'Lidl', order: 1 }));
    const p = matchStatement(data, main.id, withImportKeys(main.id, [
      row('2026-03-06', -2345, 'LIDL DEKUJE ZA NAKUP 1234', { counterparty: 'Lidl SK', note: 'card' })
    ]), '2026-03-20');
    expect(p[0]).toMatchObject({ action: 'new', categoryId: 'food', title: 'Lidl', note: 'Lidl SK · card' });
    const { newEntries } = buildImportChanges(data, p, 'now');
    expect(newEntries[0]).toMatchObject({ title: 'Lidl', amount: 2345, type: 'expense', status: 'done', isQuick: false, categoryId: 'food', accountId: main.id });
  });

  it('leaves out rows before the tracking start and in the future', () => {
    const { data, main } = budget();
    const p = matchStatement(data, main.id, withImportKeys(main.id, [row('2025-12-30', -100), row('2026-04-01', -100), row('2026-03-01', -100)]), '2026-03-20');
    expect(p.map(x => x.action)).toEqual(['skip', 'skip', 'new']);
  });

  it('finds everything again when the same file is imported twice', () => {
    const { data, main, bills } = budget();
    data.entries.push(makeEntry({ date: '2026-03-01', title: 'Rent', amount: 95000, accountId: bills.id }));
    const text = [
      'Date;Amount;Description',
      '01.03.2026;-950,00;Landlord',
      '03.03.2026;-3,50;Coffee Corner',
      '03.03.2026;-3,50;Coffee Corner',
      '05.03.2026;1500,00;Salary'
    ].join('\n');
    const first = withImportKeys(main.id, readStatement(text).rows);
    const p1 = matchStatement(data, main.id, first, '2026-03-20');
    expect(countActions(p1)).toEqual({ match: 1, recorded: 0, new: 3, skip: 0 });
    const c1 = buildImportChanges(data, p1, 'now');
    data.entries.push(...c1.newEntries);
    c1.updates.forEach(u => Object.assign(data.entries.find(e => e.id === u.id), u.patch));

    const again = withImportKeys(main.id, readStatement(text).rows);
    const p2 = matchStatement(data, main.id, again, '2026-03-20');
    expect(p2.every(x => x.action === 'recorded')).toBe(true);
    const c2 = buildImportChanges(data, p2, 'now');
    expect(c2.newEntries).toEqual([]);
    expect(c2.updates).toEqual([]);
  });

  it('an overlapping statement does not take an imported entry for another row', () => {
    const { data, main } = budget();
    const day1 = withImportKeys(main.id, [row('2026-03-01', -350, 'Coffee')]);
    data.entries.push(...buildImportChanges(data, matchStatement(data, main.id, day1, '2026-03-20'), 'now').newEntries);
    const both = withImportKeys(main.id, [row('2026-03-01', -350, 'Coffee'), row('2026-03-02', -350, 'Coffee')]);
    expect(matchStatement(data, main.id, both, '2026-03-20').map(x => x.action)).toEqual(['recorded', 'new']);
  });
});
