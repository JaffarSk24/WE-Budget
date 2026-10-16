import { describe, it, expect } from 'vitest';
import { assetValueAt, latestAssetValue, netWorthAt, netWorthHistory, transitHeld } from '../src/networth.js';
import { COLLECTIONS, emptyData, makeAccount, makeAsset, makeDebt, makeEntry, normalizeData } from '../src/model.js';

function budget() {
  const data = emptyData();
  data.settings.trackingStart = '2026-01-01';
  const main = makeAccount({ name: 'Main', openingBalance: 100000 });
  const env = makeAccount({ name: 'Envelope', parentId: main.id, openingBalance: 20000 });
  data.accounts.push(main, env);
  return { data, main, env };
}

const done = (f) => makeEntry({ status: 'done', ...f });

describe('assets in the model', () => {
  it('is a collection with defaults, and old documents load without it', () => {
    expect(COLLECTIONS).toContain('assets');
    const a = makeAsset({ name: 'Car', kind: 'vehicle', values: [{ date: '2026-03-01', amount: 900000 }, { date: '2026-01-01', amount: 1000000 }] });
    expect(a.kind).toBe('vehicle');
    expect(a.values.map(v => v.date)).toEqual(['2026-01-01', '2026-03-01']);
    expect(makeAsset({ kind: 'boat' }).kind).toBe('other');
    expect(normalizeData({ accounts: [] }).assets).toEqual([]);
    expect(normalizeData({ assets: [{ id: 'x', name: 'Flat' }] }).assets[0].values).toEqual([]);
  });

  it('takes the latest value on or before a day', () => {
    const a = makeAsset({ values: [{ date: '2026-01-10', amount: 500 }, { date: '2026-03-10', amount: 700 }] });
    expect(assetValueAt(a, '2026-01-09')).toBe(null);
    expect(assetValueAt(a, '2026-01-10')).toBe(500);
    expect(assetValueAt(a, '2026-03-09')).toBe(500);
    expect(assetValueAt(a, '2026-12-31')).toBe(700);
    expect(latestAssetValue(a).amount).toBe(700);
    expect(latestAssetValue(makeAsset())).toBe(null);
  });
});

describe('netWorthAt', () => {
  it('counts every account once, envelopes included', () => {
    const { data, main, env } = budget();
    data.entries.push(done({ date: '2026-02-01', type: 'transfer', amount: 5000, accountId: main.id, toAccountId: env.id }));
    data.entries.push(done({ date: '2026-02-02', type: 'expense', amount: 3000, accountId: env.id }));
    const nw = netWorthAt(data, '2026-02-28');
    expect(nw.accounts).toBe(117000);
    expect(nw.total).toBe(117000);
    expect(netWorthAt(data, '2026-02-01').accounts).toBe(120000);
  });

  it('adds assets and money owed to me, takes debts off', () => {
    const { data, main } = budget();
    data.assets.push(makeAsset({ name: 'Car', values: [{ date: '2026-01-01', amount: 800000 }] }));
    data.assets.push(makeAsset({ name: 'Sold', archived: true, archivedAt: '2026-02-01', values: [{ date: '2026-01-01', amount: 1000 }] }));
    data.assets.push(makeAsset({ name: 'Removed', values: [{ date: '2026-01-01', amount: 5 }] }));
    data.assets[2].deleted = true;
    const loan = makeDebt({ name: 'Loan', kind: 'owe', original: 600000, balance: 500000, balanceDate: '2026-01-01' });
    const lent = makeDebt({ name: 'Friend', kind: 'owed', original: 30000, balanceDate: '2026-01-15' });
    data.debts.push(loan, lent);
    data.entries.push(done({ date: '2026-02-05', type: 'expense', amount: 100000, accountId: main.id, debtId: loan.id }));

    const jan = netWorthAt(data, '2026-01-20');
    expect(jan.assets).toBe(801000);
    expect(jan.owedToMe).toBe(30000);
    expect(jan.debts).toBe(500000);
    expect(jan.total).toBe(120000 + 801000 + 30000 - 500000);
    expect(jan.groups.map(g => g.key)).toEqual(['accounts', 'assets', 'owedToMe', 'debts']);
    expect(jan.groups.find(g => g.key === 'debts').amount).toBe(-500000);

    const feb = netWorthAt(data, '2026-02-10');
    expect(feb.assets).toBe(800000);
    expect(feb.debts).toBe(400000);
    expect(feb.accounts).toBe(20000);
    // Paying a loan off moves money, it does not change net worth.
    expect(feb.total).toBe(20000 + 800000 + 30000 - 400000);

    // Before the friend's debt existed it is not counted.
    expect(netWorthAt(data, '2026-01-10').owedToMe).toBe(0);
  });

  it('leaves out other people\'s money passing through', () => {
    const { data, main } = budget();
    data.entries.push(done({ date: '2026-01-05', type: 'income', amount: 40000, accountId: main.id, isTransit: true }));
    expect(transitHeld(data, '2026-01-10')).toBe(40000);
    expect(netWorthAt(data, '2026-01-10').total).toBe(120000);
    data.entries.push(done({ date: '2026-01-12', type: 'expense', amount: 40000, accountId: main.id, isTransit: true }));
    expect(netWorthAt(data, '2026-01-12').transit).toBe(0);
    expect(netWorthAt(data, '2026-01-12').total).toBe(120000);
  });

  it('skips archived debts and empty data', () => {
    const data = emptyData();
    data.debts.push(makeDebt({ name: 'Old', original: 1000, archived: true }));
    expect(netWorthAt(data, '2026-01-01').total).toBe(0);
  });
});

describe('netWorthHistory', () => {
  it('gives month ends from the tracking start and the change over the period', () => {
    const { data, main } = budget();
    data.entries.push(done({ date: '2026-02-10', type: 'income', amount: 30000, accountId: main.id }));
    data.entries.push(done({ date: '2026-03-10', type: 'expense', amount: 10000, accountId: main.id }));
    const hist = netWorthHistory(data, '2026-03-15', 12);
    expect(hist.points.map(p => p.day)).toEqual(['2026-01-31', '2026-02-28', '2026-03-15']);
    expect(hist.points.map(p => p.total)).toEqual([120000, 150000, 140000]);
    expect(hist.startDay).toBe('2026-01-01');
    expect(hist.start).toBe(120000);
    expect(hist.change).toBe(20000);
  });

  it('starts the change just before the first month of a shorter period', () => {
    const { data, main } = budget();
    data.entries.push(done({ date: '2026-02-10', type: 'income', amount: 30000, accountId: main.id }));
    const hist = netWorthHistory(data, '2026-03-15', 1);
    expect(hist.points).toHaveLength(1);
    expect(hist.startDay).toBe('2026-02-28');
    expect(hist.change).toBe(0);
  });
});
