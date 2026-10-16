import { describe, it, expect } from 'vitest';
import { goalContributions, sankeyData } from '../src/sankey.js';
import { emptyData, makeAccount, makeCategory, makeEntry, makeGoal } from '../src/model.js';

function budget() {
  const data = emptyData();
  const main = makeAccount({ name: 'Main', openingBalance: 100000 });
  data.accounts.push(main);
  const cat = (name, type = 'expense') => { const c = makeCategory({ name, type }); data.categories.push(c); return c; };
  return { data, main, cat };
}

const done = (f) => makeEntry({ status: 'done', ...f });
const sum = (list) => list.reduce((s, x) => s + x.amount, 0);

describe('sankeyData', () => {
  it('balances both sides and puts the rest into Saved', () => {
    const { data, main, cat } = budget();
    const salary = cat('Salary', 'income');
    const food = cat('Food');
    const rent = cat('Rent');
    data.entries.push(done({ date: '2026-09-01', type: 'income', amount: 300000, accountId: main.id, categoryId: salary.id }));
    data.entries.push(done({ date: '2026-09-02', type: 'expense', amount: 120000, accountId: main.id, categoryId: rent.id }));
    data.entries.push(done({ date: '2026-09-03', type: 'expense', amount: 30000, accountId: main.id, categoryId: food.id }));
    // Not real flows: planned, transit, adjustments, other months.
    data.entries.push(makeEntry({ date: '2026-09-04', type: 'expense', amount: 999, accountId: main.id, categoryId: food.id }));
    data.entries.push(done({ date: '2026-09-04', type: 'expense', amount: 999, accountId: main.id, isTransit: true }));
    data.entries.push(done({ date: '2026-09-04', type: 'expense', amount: 999, accountId: main.id, isAdjustment: true }));
    data.entries.push(done({ date: '2026-10-01', type: 'expense', amount: 999, accountId: main.id, categoryId: food.id }));

    const s = sankeyData(data, '2026-09-01', '2026-09-30');
    expect(s.income).toBe(300000);
    expect(s.expense).toBe(150000);
    expect(s.saved).toBe(150000);
    expect(s.fromSavings).toBe(0);
    expect(s.targets.map(x => x.key)).toEqual([`cat:${rent.id}`, `cat:${food.id}`, 'saved']);
    const ins = s.links.filter(l => l.target === 'income');
    const outs = s.links.filter(l => l.source === 'income');
    expect(sum(ins)).toBe(sum(outs));
    expect(sum(ins)).toBe(s.total);
    expect(s.empty).toBe(false);
  });

  it('takes the difference from savings when more went out', () => {
    const { data, main, cat } = budget();
    const salary = cat('Salary', 'income');
    data.entries.push(done({ date: '2026-09-01', type: 'income', amount: 1000, accountId: main.id, categoryId: salary.id }));
    data.entries.push(done({ date: '2026-09-02', type: 'expense', amount: 1500, accountId: main.id }));
    const s = sankeyData(data, '2026-09-01', '2026-09-30');
    expect(s.fromSavings).toBe(500);
    expect(s.sources.map(x => x.key)).toEqual([`cat:${salary.id}`, 'from-savings']);
    expect(s.targets.map(x => x.key)).toEqual(['cat:none']);
    expect(sum(s.sources)).toBe(sum(s.targets));
  });

  it('groups small categories into Other', () => {
    const { data, main, cat } = budget();
    for (let i = 0; i < 6; i++) {
      const c = cat(`C${i}`);
      data.entries.push(done({ date: '2026-09-05', type: 'expense', amount: (i + 1) * 100, accountId: main.id, categoryId: c.id }));
    }
    const s = sankeyData(data, '2026-09-01', '2026-09-30', { maxCategories: 4 });
    const other = s.targets.find(x => x.key === 'other-expense');
    expect(s.targets.filter(x => x.key.startsWith('cat:'))).toHaveLength(3);
    expect(other.count).toBe(3);
    expect(other.amount).toBe(100 + 200 + 300);
    expect(sum(s.targets)).toBe(s.total);
    // No income at all: everything came from savings.
    expect(s.fromSavings).toBe(2100);
  });

  it('is empty for a period without flows', () => {
    const { data } = budget();
    const s = sankeyData(data, '2026-09-01', '2026-09-30');
    expect(s.empty).toBe(true);
    expect(s.links).toEqual([]);
    expect(s.total).toBe(0);
  });

  it('counts money moved into a goal as saved', () => {
    const { data, main, cat } = budget();
    const salary = cat('Salary', 'income');
    const goalAcc = makeAccount({ name: 'Trip', kind: 'savings' });
    data.accounts.push(goalAcc);
    data.goals.push(makeGoal({ name: 'Trip', targetAmount: 100000, accountId: goalAcc.id }));
    data.entries.push(done({ date: '2026-09-01', type: 'income', amount: 10000, accountId: main.id, categoryId: salary.id }));
    data.entries.push(done({ date: '2026-09-02', type: 'transfer', amount: 4000, accountId: main.id, toAccountId: goalAcc.id }));
    expect(goalContributions(data, '2026-09-01', '2026-09-30')).toBe(4000);
    const s = sankeyData(data, '2026-09-01', '2026-09-30');
    expect(s.saved).toBe(10000);
    expect(s.toGoals).toBe(4000);
  });
});
