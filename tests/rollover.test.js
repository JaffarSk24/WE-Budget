import { describe, it, expect } from 'vitest';
import { budgetAlerts, effectiveLimit, limitCarry, limitChangePatch } from '../src/ledger.js';
import { emptyData, makeAccount, makeCategory, makeEntry, normalizeData } from '../src/model.js';

function budget(rollover = {}) {
  const data = emptyData();
  const main = makeAccount({ name: 'Main', openingBalance: 500000 });
  const cafe = makeCategory({ name: 'Cafe', type: 'expense', monthlyLimit: 10000, ...rollover });
  data.accounts.push(main);
  data.categories.push(cafe);
  const spend = (date, amount, f = {}) => data.entries.push(makeEntry({ date, amount, type: 'expense', status: 'done', accountId: main.id, categoryId: cafe.id, ...f }));
  return { data, cafe, spend };
}

describe('limit rollover', () => {
  it('without rollover the limit is the limit; no limit gives null', () => {
    const { data, cafe, spend } = budget();
    spend('2026-08-03', 4000);
    expect(cafe.limitRollover).toBe('none');
    expect(effectiveLimit(data, cafe.id, '2026-09')).toBe(10000);
    const free = makeCategory({ name: 'Free', type: 'expense' });
    data.categories.push(free);
    expect(effectiveLimit(data, free.id, '2026-09')).toBe(null);
    expect(effectiveLimit(data, 'missing', '2026-09')).toBe(null);
  });

  it("'unspent' carries what was left over several months, overspending only resets", () => {
    const { data, cafe, spend } = budget({ limitRollover: 'unspent', rolloverFrom: '2026-07' });
    spend('2026-06-10', 1000); // before the option was switched on: ignored
    spend('2026-07-10', 6000); // 40 left
    spend('2026-08-10', 9000); // limit 140, 50 left
    spend('2026-09-10', 20000); // limit 150, over by 50
    expect(effectiveLimit(data, cafe.id, '2026-06')).toBe(10000);
    expect(effectiveLimit(data, cafe.id, '2026-07')).toBe(10000);
    expect(effectiveLimit(data, cafe.id, '2026-08')).toBe(14000);
    expect(effectiveLimit(data, cafe.id, '2026-09')).toBe(15000);
    expect(effectiveLimit(data, cafe.id, '2026-10')).toBe(10000);
    expect(limitCarry(data, cafe, '2026-09')).toBe(5000);
  });

  it("'both' takes overspending off the next month, never below zero", () => {
    const { data, cafe, spend } = budget({ limitRollover: 'both', rolloverFrom: '2026-07' });
    spend('2026-07-10', 13000); // over by 30
    spend('2026-08-10', 2000); // limit 70, 50 left
    expect(effectiveLimit(data, cafe.id, '2026-08')).toBe(7000);
    expect(effectiveLimit(data, cafe.id, '2026-09')).toBe(15000);
    spend('2026-09-10', 40000); // limit 150, over by 250
    expect(limitCarry(data, cafe, '2026-10')).toBe(-25000);
    expect(effectiveLimit(data, cafe.id, '2026-10')).toBe(0);
    // Nothing spent in October pays part of it back.
    expect(effectiveLimit(data, cafe.id, '2026-11')).toBe(0);
    expect(limitCarry(data, cafe, '2026-11')).toBe(-15000);
    expect(effectiveLimit(data, cafe.id, '2026-12')).toBe(5000);
  });

  it('switching off drops the carried amount; switching on starts from nothing', () => {
    const { data, cafe, spend } = budget({ limitRollover: 'unspent', rolloverFrom: '2026-07' });
    spend('2026-07-10', 2000);
    expect(effectiveLimit(data, cafe.id, '2026-08')).toBe(18000);
    Object.assign(cafe, limitChangePatch(data, cafe, { limitRollover: 'none' }, '2026-08'));
    expect(cafe.rolloverFrom).toBe(null);
    expect(effectiveLimit(data, cafe.id, '2026-08')).toBe(10000);
    Object.assign(cafe, limitChangePatch(data, cafe, { limitRollover: 'unspent' }, '2026-09'));
    expect(cafe.rolloverFrom).toBe('2026-09');
    expect(effectiveLimit(data, cafe.id, '2026-09')).toBe(10000);
    expect(effectiveLimit(data, cafe.id, '2026-10')).toBe(20000);
  });

  it('a limit changed midway keeps what was carried under the old one', () => {
    const { data, cafe, spend } = budget({ limitRollover: 'unspent', rolloverFrom: '2026-07' });
    spend('2026-07-10', 4000); // 60 carried
    Object.assign(cafe, limitChangePatch(data, cafe, { monthlyLimit: 20000 }, '2026-08'));
    expect(cafe).toMatchObject({ monthlyLimit: 20000, rolloverFrom: '2026-08', rolloverCarry: 6000 });
    expect(effectiveLimit(data, cafe.id, '2026-08')).toBe(26000);
    spend('2026-08-10', 16000);
    expect(effectiveLimit(data, cafe.id, '2026-09')).toBe(30000);
    // Months before the change are not recounted: they show the plain limit.
    expect(effectiveLimit(data, cafe.id, '2026-07')).toBe(20000);
    // Removing the limit switches carrying off.
    expect(limitChangePatch(data, cafe, { monthlyLimit: null }, '2026-09')).toEqual({ monthlyLimit: null, limitRollover: 'none', rolloverFrom: null, rolloverCarry: 0 });
  });

  it('planned, transit and other categories do not count as spent', () => {
    const { data, cafe, spend } = budget({ limitRollover: 'unspent', rolloverFrom: '2026-07' });
    spend('2026-07-10', 5000, { status: 'planned' });
    spend('2026-07-11', 5000, { isTransit: true });
    spend('2026-07-12', 5000, { categoryId: 'other' });
    expect(effectiveLimit(data, cafe.id, '2026-08')).toBe(20000);
  });

  it('old categories load without the new fields and count as no rollover', () => {
    const data = normalizeData({ categories: [{ id: 'c1', name: 'Old', type: 'expense', monthlyLimit: 5000 }] });
    expect(effectiveLimit(data, 'c1', '2026-10')).toBe(5000);
  });

  it('alerts compare with the limit including what carried over', () => {
    const { data, cafe, spend } = budget({ limitRollover: 'unspent', rolloverFrom: '2026-09' });
    spend('2026-09-10', 0);
    spend('2026-10-05', 9000); // 90% of 100, 45% of 200
    expect(effectiveLimit(data, cafe.id, '2026-10')).toBe(20000);
    expect(budgetAlerts(data, '2026-10-16').filter(a => a.categoryId === cafe.id)).toEqual([]);
    spend('2026-10-06', 8000);
    const [alert] = budgetAlerts(data, '2026-10-16').filter(a => a.categoryId === cafe.id);
    expect(alert).toMatchObject({ kind: 'limit-near', limit: 20000, percent: 85 });
  });
});
