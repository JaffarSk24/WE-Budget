import { describe, it, expect } from 'vitest';
import { makeAccount, makeCategory, makeEntry, emptyData } from '../src/model.js';
import { foldText, parseAmountToken, searchEntries, hasActiveFilters, compareNewestFirst } from '../src/search.js';

function fixture() {
  const data = emptyData();
  const bank = makeAccount({ name: 'Tatra' });
  const envelope = makeAccount({ name: 'Byt', parentId: bank.id });
  const cash = makeAccount({ name: 'Наличные', kind: 'cash' });
  const food = makeCategory({ name: 'Potraviny', type: 'expense' });
  const salary = makeCategory({ name: 'Зарплата', type: 'income' });
  data.accounts.push(bank, envelope, cash);
  data.categories.push(food, salary);
  const e = (f) => makeEntry({ accountId: bank.id, ...f });
  const coffee = e({ title: 'Káva', amount: 1250, date: '2026-10-03', categoryId: food.id, isQuick: true, status: 'done' });
  const rent = e({ title: 'Nájom', amount: 65000, date: '2026-10-01', accountId: envelope.id, note: 'za október' });
  const pay = e({ title: 'Зарплата октябрь', type: 'income', amount: 210000, date: '2026-10-10', categoryId: salary.id });
  const move = e({ title: 'Snimanie', type: 'transfer', amount: 5000, date: '2026-09-20', toAccountId: cash.id });
  const gone = e({ title: 'Kino', amount: 1200, date: '2026-10-05', status: 'cancelled', accountId: cash.id });
  const deleted = e({ title: 'Káva stará', amount: 1250, date: '2026-10-04' });
  deleted.deleted = true;
  data.entries.push(coffee, rent, pay, move, gone, deleted);
  return { data, bank, envelope, cash, food, salary, coffee, rent, pay, move, gone };
}

const ids = (r) => r.results.map(e => e.id);

describe('search helpers', () => {
  it('folds case and diacritics, Latin and Cyrillic', () => {
    expect(foldText('Káva ŽĽTÁ')).toBe('kava zlta');
    expect(foldText('ЁЛКА')).toBe('елка');
    expect(foldText(null)).toBe('');
  });

  it('reads amounts typed with a comma, a dot or none', () => {
    expect(parseAmountToken('12,50')).toEqual({ cents: 1250, whole: false });
    expect(parseAmountToken('12.5')).toEqual({ cents: 1250, whole: false });
    expect(parseAmountToken('12')).toEqual({ cents: 1200, whole: true });
    expect(parseAmountToken('12€')).toEqual({ cents: 1200, whole: true });
    expect(parseAmountToken('kava')).toBe(null);
    expect(parseAmountToken('12,505')).toBe(null);
  });

  it('knows when filters are set', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ type: '', accountId: null })).toBe(false);
    expect(hasActiveFilters({ quickOnly: true })).toBe(true);
  });

  it('sorts newest first, then by creation time', () => {
    const list = [
      { date: '2026-10-01', createdAt: 'a' },
      { date: '2026-10-02', createdAt: 'a' },
      { date: '2026-10-01', createdAt: 'b' }
    ].sort(compareNewestFirst);
    expect(list.map(x => x.date + x.createdAt)).toEqual(['2026-10-02a', '2026-10-01b', '2026-10-01a']);
  });
});

describe('searchEntries', () => {
  it('without a query returns every live entry, newest first', () => {
    const f = fixture();
    expect(ids(searchEntries(f.data, ''))).toEqual([f.pay.id, f.gone.id, f.coffee.id, f.rent.id, f.move.id]);
  });

  it('finds by title regardless of case and accents', () => {
    const f = fixture();
    expect(ids(searchEntries(f.data, 'KAVA'))).toEqual([f.coffee.id]);
    expect(ids(searchEntries(f.data, 'najom'))).toEqual([f.rent.id]);
  });

  it('finds Cyrillic text in titles and category names', () => {
    const f = fixture();
    expect(ids(searchEntries(f.data, 'зарпл'))).toEqual([f.pay.id]);
    expect(ids(searchEntries(f.data, 'НАЛИЧН'))).toEqual([f.gone.id, f.move.id]);
  });

  it('finds by note, category and account, envelopes with their account', () => {
    const f = fixture();
    expect(ids(searchEntries(f.data, 'oktober'))).toEqual([f.rent.id]);
    expect(ids(searchEntries(f.data, 'potrav'))).toEqual([f.coffee.id]);
    expect(ids(searchEntries(f.data, 'byt'))).toEqual([f.rent.id]);
    expect(ids(searchEntries(f.data, 'tatra byt'))).toEqual([f.rent.id]);
  });

  it('finds by amount', () => {
    const f = fixture();
    expect(ids(searchEntries(f.data, '12,50'))).toEqual([f.coffee.id]);
    expect(ids(searchEntries(f.data, '12.50'))).toEqual([f.coffee.id]);
    expect(ids(searchEntries(f.data, '12'))).toEqual([f.gone.id, f.coffee.id]);
    expect(ids(searchEntries(f.data, '650'))).toEqual([f.rent.id]);
  });

  it('needs every word of the query', () => {
    const f = fixture();
    expect(ids(searchEntries(f.data, 'kava 12'))).toEqual([f.coffee.id]);
    expect(ids(searchEntries(f.data, 'kava 13'))).toEqual([]);
  });

  it('filters by date range, type, status and quick entries', () => {
    const f = fixture();
    expect(ids(searchEntries(f.data, '', { from: '2026-10-01', to: '2026-10-03' }))).toEqual([f.coffee.id, f.rent.id]);
    expect(ids(searchEntries(f.data, '', { type: 'transfer' }))).toEqual([f.move.id]);
    expect(ids(searchEntries(f.data, '', { status: 'cancelled' }))).toEqual([f.gone.id]);
    expect(ids(searchEntries(f.data, '', { quickOnly: true }))).toEqual([f.coffee.id]);
    expect(ids(searchEntries(f.data, '', { categoryId: f.salary.id }))).toEqual([f.pay.id]);
  });

  it('an account filter takes in its envelopes and transfers to it', () => {
    const f = fixture();
    expect(ids(searchEntries(f.data, '', { accountId: f.bank.id }))).toEqual([f.pay.id, f.coffee.id, f.rent.id, f.move.id]);
    expect(ids(searchEntries(f.data, '', { accountId: f.envelope.id }))).toEqual([f.rent.id]);
    expect(ids(searchEntries(f.data, '', { accountId: f.cash.id }))).toEqual([f.gone.id, f.move.id]);
  });

  it('adds up expenses and incomes without cancelled entries', () => {
    const f = fixture();
    const r = searchEntries(f.data, '');
    expect(r.count).toBe(5);
    expect(r.expense).toBe(1250 + 65000);
    expect(r.income).toBe(210000);
  });

  it('copes with empty data', () => {
    expect(searchEntries(emptyData(), 'x')).toEqual({ results: [], count: 0, expense: 0, income: 0 });
    expect(searchEntries({}, '').count).toBe(0);
  });
});
