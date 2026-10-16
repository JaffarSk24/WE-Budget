import { describe, it, expect } from 'vitest';
import { emptyData, makeAccount, makeCategory, makeEntry, normalizeData } from '../src/model.js';
import { categoryParts, rescaleSplits, splitFields, fitSplits, splitRemainder, hasSplits } from '../src/splits.js';
import { categoryTotals, categorySpentInMonth, categoryBreakdown, categoryAverages, budgetAlerts, accountSummaries } from '../src/ledger.js';
import { searchEntries } from '../src/search.js';
import { Store, memoryAdapter } from '../src/store.js';

function fixture() {
  const data = emptyData();
  data.settings.trackingStart = '2026-01-01';
  const bank = makeAccount({ name: 'Main', openingBalance: 100000 });
  const food = makeCategory({ name: 'Groceries', monthlyLimit: 5000 });
  const home = makeCategory({ name: 'Household' });
  const kids = makeCategory({ name: 'Kids' });
  data.accounts.push(bank);
  data.categories.push(food, home, kids);
  const receipt = makeEntry({
    title: 'Supermarket', amount: 6000, date: '2026-10-03', accountId: bank.id, categoryId: food.id, status: 'done',
    splits: [
      { categoryId: food.id, amount: 4000, note: '' },
      { categoryId: home.id, amount: 1200, note: 'detergent' },
      { categoryId: kids.id, amount: 800, note: 'crayons' }
    ]
  });
  const plain = makeEntry({ title: 'Bakery', amount: 500, date: '2026-10-04', accountId: bank.id, categoryId: food.id, status: 'done' });
  data.entries.push(receipt, plain);
  return { data, bank, food, home, kids, receipt, plain };
}

describe('categoryParts', () => {
  it('gives the whole amount in the own category without splits', () => {
    expect(categoryParts({ type: 'expense', amount: 700, categoryId: 'c1' })).toEqual([{ categoryId: 'c1', amount: 700 }]);
    expect(categoryParts({ type: 'expense', amount: 700, categoryId: null, splits: [] })).toEqual([{ categoryId: null, amount: 700 }]);
  });

  it('gives the parts of a split entry', () => {
    const { receipt, food, home, kids } = fixture();
    expect(categoryParts(receipt)).toEqual([
      { categoryId: food.id, amount: 4000 }, { categoryId: home.id, amount: 1200 }, { categoryId: kids.id, amount: 800 }
    ]);
  });

  it('scales parts that drifted from the amount back onto it', () => {
    const parts = categoryParts({ type: 'expense', amount: 1000, splits: [{ categoryId: 'a', amount: 300 }, { categoryId: 'b', amount: 200 }] });
    expect(parts).toEqual([{ categoryId: 'a', amount: 600 }, { categoryId: 'b', amount: 400 }]);
  });

  it('ignores splits on a transfer', () => {
    expect(hasSplits({ type: 'transfer', splits: [{ categoryId: 'a', amount: 1 }] })).toBe(false);
  });
});

describe('rescaleSplits', () => {
  it('scales in proportion and puts the rounding on the largest part', () => {
    const out = rescaleSplits([{ categoryId: 'a', amount: 4000 }, { categoryId: 'b', amount: 1200 }, { categoryId: 'c', amount: 800 }], 6100);
    expect(out.map(p => p.amount)).toEqual([4067, 1220, 813]);
    expect(out.reduce((s, p) => s + p.amount, 0)).toBe(6100);
  });

  it('fixes the rounding on the largest part, not the first', () => {
    const out = rescaleSplits([{ categoryId: 'a', amount: 1 }, { categoryId: 'b', amount: 1 }, { categoryId: 'c', amount: 2 }], 3);
    expect(out.reduce((s, p) => s + p.amount, 0)).toBe(3);
    expect(out[2].amount).toBe(1);
  });

  it('keeps parts that already fit and does not mutate the input', () => {
    const input = [{ categoryId: 'a', amount: 300, note: 'x' }, { categoryId: 'b', amount: 700 }];
    const out = rescaleSplits(input, 2000);
    expect(input[0].amount).toBe(300);
    expect(out).toEqual([{ categoryId: 'a', amount: 600, note: 'x' }, { categoryId: 'b', amount: 1400 }]);
    expect(rescaleSplits(out, 2000)).toEqual(out);
  });

  it('gives a total to the first part when all parts were zero', () => {
    expect(rescaleSplits([{ amount: 0 }, { amount: 0 }], 500).map(p => p.amount)).toEqual([500, 0]);
  });
});

describe('splitFields, fitSplits and the remainder', () => {
  it('takes the category of the largest part and drops empty parts', () => {
    const f = splitFields([{ categoryId: 'a', amount: 200, note: ' x ' }, { categoryId: 'b', amount: 500 }, { categoryId: 'c', amount: 0 }]);
    expect(f.categoryId).toBe('b');
    expect(f.splits).toEqual([{ categoryId: 'a', amount: 200, note: 'x' }, { categoryId: 'b', amount: 500, note: '' }]);
  });

  it('turns a single part back into one category', () => {
    expect(splitFields([{ categoryId: 'a', amount: 200 }], 'z')).toEqual({ splits: null, categoryId: 'a' });
    expect(splitFields([], 'z')).toEqual({ splits: null, categoryId: 'z' });
  });

  it('fits parts to a new amount', () => {
    const e = { type: 'expense', amount: 2000, categoryId: 'b', splits: [{ categoryId: 'a', amount: 300 }, { categoryId: 'b', amount: 700 }] };
    expect(fitSplits(e)).toEqual({ splits: [{ categoryId: 'a', amount: 600 }, { categoryId: 'b', amount: 1400 }], categoryId: 'b' });
    expect(fitSplits({ ...e, amount: 1000 })).toBe(null);
    expect(fitSplits({ type: 'expense', amount: 5 })).toBe(null);
  });

  it('tells what is left to split', () => {
    expect(splitRemainder(1000, [{ amount: 580 }])).toBe(420);
    expect(splitRemainder(1000, [{ amount: 580 }, { amount: 500 }])).toBe(-80);
  });
});

describe('category figures with split payments', () => {
  it('categoryTotals and categoryBreakdown count the parts', () => {
    const { data, food, home, kids } = fixture();
    const totals = categoryTotals(data, '2026-10-01', '2026-10-31');
    expect(totals.get(food.id)).toBe(4500);
    expect(totals.get(home.id)).toBe(1200);
    expect(totals.get(kids.id)).toBe(800);
    expect(categoryBreakdown(data, '2026-10-01', '2026-10-31')).toEqual([
      { categoryId: food.id, amount: 4500 }, { categoryId: home.id, amount: 1200 }, { categoryId: kids.id, amount: 800 }
    ]);
  });

  it('categorySpentInMonth, averages and limit alerts count only the part', () => {
    const { data, food, home } = fixture();
    expect(categorySpentInMonth(data, food.id, '2026-10')).toBe(4500);
    expect(categorySpentInMonth(data, home.id, '2026-10')).toBe(1200);
    expect(categoryAverages(data, '2026-11', 1).get(home.id)).toBe(1200);
    const alert = budgetAlerts(data, '2026-10-20').find(a => a.categoryId === food.id);
    expect(alert.percent).toBe(90);
  });

  it('balances still see one payment', () => {
    const { data, bank } = fixture();
    expect(accountSummaries(data, '2026-10-31').get(bank.id).totalBalance).toBe(100000 - 6500);
  });
});

describe('search with split payments', () => {
  it('finds a payment by the category or the note of a part', () => {
    const { data, receipt, kids } = fixture();
    expect(searchEntries(data, 'household').results.map(e => e.id)).toEqual([receipt.id]);
    expect(searchEntries(data, 'crayons').results.map(e => e.id)).toEqual([receipt.id]);
    expect(searchEntries(data, '', { categoryId: kids.id }).results.map(e => e.id)).toEqual([receipt.id]);
  });
});

describe('store keeps parts in line with the amount', () => {
  function storeWith(data) {
    return new Store(memoryAdapter(JSON.stringify(data)), { today: () => '2026-10-10' });
  }

  it('scales the parts when the amount is edited in place', () => {
    const { data, receipt } = fixture();
    const store = storeWith(data);
    store.update('entries', receipt.id, { amount: 3000 });
    const e = store.find('entries', receipt.id);
    expect(e.splits.map(p => p.amount)).toEqual([2000, 600, 400]);
  });

  it('scales the parts when marked done with another amount', () => {
    const { data, receipt } = fixture();
    receipt.status = 'planned';
    const store = storeWith(data);
    store.setStatus(receipt.id, 'done', { amount: 12000 });
    expect(store.find('entries', receipt.id).splits.map(p => p.amount)).toEqual([8000, 2400, 1600]);
  });

  it('loads old documents without the new fields', () => {
    const raw = { entries: [{ id: 'x', amount: 5, status: 'done' }], templates: [{ id: 't', schedule: {} }] };
    const data = normalizeData(raw);
    expect(data.entries[0].tagIds).toEqual([]);
    expect(data.templates[0].tagIds).toEqual([]);
    expect(data.tags).toEqual([]);
  });
});

describe('csvParts', () => {
  it('gives one line per part with a mark, or one plain line', async () => {
    const { csvParts } = await import('../src/splits.js');
    const { receipt, plain, food, kids } = fixture();
    const lines = csvParts(receipt);
    expect(lines.map(l => l.part)).toEqual(['1/3', '2/3', '3/3']);
    expect(lines[2]).toEqual({ categoryId: kids.id, amount: 800, note: 'crayons', part: '3/3' });
    expect(csvParts(plain)).toEqual([{ categoryId: food.id, amount: 500, note: '', part: '' }]);
  });
});
