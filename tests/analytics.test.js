import { describe, it, expect } from 'vitest';
import { analyticsByMonth, categoryBreakdown, categoryAverages, firstFlowMonth } from '../src/ledger.js';
import { emptyData, makeAccount, makeCategory, makeEntry } from '../src/model.js';

function budget() {
  const data = emptyData();
  const acc = makeAccount({ name: 'Main' });
  const other = makeAccount({ name: 'Savings' });
  const food = makeCategory({ name: 'Food', type: 'expense' });
  const rent = makeCategory({ name: 'Rent', type: 'expense' });
  const salary = makeCategory({ name: 'Salary', type: 'income' });
  data.accounts.push(acc, other);
  data.categories.push(food, rent, salary);
  const add = (f) => { const e = makeEntry({ accountId: acc.id, status: 'done', ...f }); data.entries.push(e); return e; };
  return { data, acc, other, food, rent, salary, add };
}

describe('analytics', () => {
  it('sums each month apart, keeps transit, transfers and adjustments out of the flows', () => {
    const { data, other, food, rent, salary, add } = budget();
    add({ date: '2026-08-01', type: 'income', amount: 300000, categoryId: salary.id });
    add({ date: '2026-08-02', type: 'expense', amount: 90000, plannedAmount: 90000, categoryId: rent.id });
    add({ date: '2026-08-10', type: 'expense', amount: 12000, plannedAmount: 10000, categoryId: food.id });
    add({ date: '2026-08-11', type: 'expense', amount: 800, isQuick: true, categoryId: food.id });
    add({ date: '2026-08-12', type: 'expense', amount: 5000, isTransit: true });
    add({ date: '2026-08-13', type: 'transfer', amount: 40000, toAccountId: other.id });
    add({ date: '2026-08-20', type: 'expense', amount: 3000, isAdjustment: true });
    add({ date: '2026-08-25', type: 'expense', amount: 7000, status: 'cancelled', categoryId: food.id });
    add({ date: '2026-09-05', type: 'expense', amount: 20000, plannedAmount: 20000, status: 'planned', categoryId: food.id });
    const rows = analyticsByMonth(data, '2026-08', '2026-09');
    expect(rows).toEqual([
      { month: '2026-08', income: 300000, expense: 102800, plan: 100000, adjustments: -3000 },
      { month: '2026-09', income: 0, expense: 0, plan: 20000, adjustments: 0 }
    ]);
  });

  it('breaks a period down by category, largest first, and averages full months', () => {
    const { data, food, rent, add } = budget();
    add({ date: '2026-07-03', type: 'expense', amount: 90000, categoryId: rent.id });
    add({ date: '2026-08-03', type: 'expense', amount: 90000, categoryId: rent.id });
    add({ date: '2026-08-15', type: 'expense', amount: 30000, categoryId: food.id });
    add({ date: '2026-09-15', type: 'expense', amount: 99999, categoryId: food.id });
    add({ date: '2026-08-16', type: 'expense', amount: 500 });
    expect(categoryBreakdown(data, '2026-07-01', '2026-08-31')).toEqual([
      { categoryId: rent.id, amount: 180000 },
      { categoryId: food.id, amount: 30000 },
      { categoryId: null, amount: 500 }
    ]);
    // Two full months before September: July and August.
    const avg = categoryAverages(data, '2026-09', 2);
    expect(avg.get(rent.id)).toBe(90000);
    expect(avg.get(food.id)).toBe(15000);
    expect(firstFlowMonth(data)).toBe('2026-07');
  });
});
