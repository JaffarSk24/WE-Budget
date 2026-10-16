import { describe, it, expect } from 'vitest';
import { COLLECTIONS, emptyData, makeAccount, makeEntry, makeGoal, makeScenario, normalizeData } from '../src/model.js';
import {
  forecast, forecastWithScenarios, grandTotals, monthRows, monthSummary, budgetAlerts,
  scenarioDays, scenarioEntries, scenarioImpact
} from '../src/ledger.js';

function household() {
  const data = emptyData();
  data.settings.trackingStart = '2026-10-01';
  const main = makeAccount({ name: 'Main', openingBalance: 50000 });
  data.accounts.push(main);
  const add = (f) => { const e = makeEntry(f); data.entries.push(e); return e; };
  return { data, main, add };
}

describe('what-if drafts: model', () => {
  it('is a collection with sane defaults and old documents load without it', () => {
    expect(COLLECTIONS).toContain('scenarios');
    const s = makeScenario({ title: 'Laptop', amount: 120000.4, date: '2026-12-10', months: 'x' });
    expect(s).toMatchObject({ type: 'expense', amount: 120000, repeat: 'once', months: null, active: true, deleted: false });
    expect(makeScenario({ type: 'income', repeat: 'monthly', months: 6, active: false })).toMatchObject({ type: 'income', repeat: 'monthly', months: 6, active: false });
    expect(makeScenario({ repeat: 'weekly' }).repeat).toBe('once');
    const old = normalizeData({ accounts: [], entries: [] });
    expect(old.scenarios).toEqual([]);
  });
});

describe('what-if drafts: days', () => {
  it('puts a one-off draft on its day, or today when it is in the past', () => {
    expect(scenarioDays(makeScenario({ amount: 100, date: '2026-12-10' }), '2026-10-05', '2027-01-31')).toEqual(['2026-12-10']);
    expect(scenarioDays(makeScenario({ amount: 100, date: '2026-09-10' }), '2026-10-05', '2027-01-31')).toEqual(['2026-10-05']);
    expect(scenarioDays(makeScenario({ amount: 100, date: '2027-03-10' }), '2026-10-05', '2027-01-31')).toEqual([]);
  });

  it('repeats a monthly draft on its day, clamps short months and stops after N months', () => {
    const gym = makeScenario({ amount: 4000, date: '2026-10-31', repeat: 'monthly' });
    expect(scenarioDays(gym, '2026-10-05', '2027-01-31')).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
    const limited = makeScenario({ amount: 4000, date: '2026-10-15', repeat: 'monthly', months: 2 });
    expect(scenarioDays(limited, '2026-10-05', '2027-01-31')).toEqual(['2026-10-15', '2026-11-15']);
    // Months already behind are not counted again.
    const started = makeScenario({ amount: 4000, date: '2026-08-15', repeat: 'monthly', months: 3 });
    expect(scenarioDays(started, '2026-10-05', '2027-01-31')).toEqual(['2026-10-15']);
  });

  it('skips drafts that are off, deleted, without a date or an amount', () => {
    const list = [
      makeScenario({ amount: 100, date: '2026-11-01' }),
      makeScenario({ amount: 100, date: '2026-11-01', active: false }),
      { ...makeScenario({ amount: 100, date: '2026-11-01' }), deleted: true },
      makeScenario({ amount: 100 }),
      makeScenario({ amount: 0, date: '2026-11-01' })
    ];
    const entries = scenarioEntries(list, '2026-10-05', '2026-12-31');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scenarioId: list[0].id, date: '2026-11-01', status: 'planned', type: 'expense' });
  });
});

describe('what-if drafts: forecast', () => {
  it('adds active drafts to the forecast only', () => {
    const { data, main, add } = household();
    add({ date: '2026-10-20', type: 'expense', amount: 10000, accountId: main.id });
    data.scenarios.push(makeScenario({ title: 'Laptop', amount: 30000, date: '2026-11-10', accountId: main.id }));
    data.scenarios.push(makeScenario({ title: 'Gym', amount: 4000, date: '2026-10-25', repeat: 'monthly', accountId: main.id }));
    data.scenarios.push(makeScenario({ title: 'Bonus', type: 'income', amount: 99900, date: '2026-10-26', active: false }));

    const base = forecast(data, '2026-10-05', '2026-11-30');
    const f = forecastWithScenarios(data, '2026-10-05', '2026-11-30');
    expect(base.end).toBe(40000);
    // Laptop once, gym twice (25 Oct, 25 Nov); the bonus is off.
    expect(f.end).toBe(40000 - 30000 - 8000);
    expect(f.start).toBe(base.start);
    expect(f.points).toHaveLength(base.points.length);

    // Nothing else in the budget sees them.
    expect(data.entries).toHaveLength(1);
    expect(grandTotals(data, '2026-10-05').free).toBe(50000);
    expect(monthRows(data, '2026-11')).toHaveLength(0);
    expect(monthSummary(data, '2026-10').expense).toBe(10000);
    expect(budgetAlerts(data, '2026-10-05').some(a => /Laptop|Gym/.test(JSON.stringify(a)))).toBe(false);
  });

  it('is the plain forecast without active drafts', () => {
    const { data, main, add } = household();
    add({ date: '2026-10-20', type: 'expense', amount: 10000, accountId: main.id });
    expect(forecastWithScenarios(data, '2026-10-05', '2026-10-31')).toEqual(forecast(data, '2026-10-05', '2026-10-31'));
  });

  it('leaves out a draft paid from a goal\'s money, like a real entry', () => {
    const { data } = household();
    const goalAccount = makeAccount({ name: 'Trip', openingBalance: 20000 });
    data.accounts.push(goalAccount);
    data.goals.push(makeGoal({ name: 'Trip', targetAmount: 30000, accountId: goalAccount.id }));
    data.scenarios.push(makeScenario({ amount: 5000, date: '2026-10-10', accountId: goalAccount.id }));
    expect(forecastWithScenarios(data, '2026-10-05', '2026-10-31').end).toBe(50000);
  });
});

describe('what-if drafts: impact', () => {
  it('tells the lowest point with and without drafts and when money runs out', () => {
    const { data, main, add } = household();
    add({ date: '2026-10-10', type: 'expense', amount: 20000, accountId: main.id });
    add({ date: '2026-11-05', type: 'income', amount: 30000, accountId: main.id });
    data.scenarios.push(makeScenario({ title: 'Laptop', amount: 40000, date: '2026-10-20', accountId: main.id }));

    const impact = scenarioImpact(data, '2026-10-05', '2026-11-30');
    expect(impact.active).toBe(true);
    expect(impact.lowestWithout).toEqual({ day: '2026-10-10', value: 30000 });
    expect(impact.lowest).toEqual({ day: '2026-10-20', value: -10000 });
    expect(impact.firstNegativeWithout).toBe(null);
    expect(impact.firstNegative.day).toBe('2026-10-20');
    expect(impact.firstNegative.entry.title).toBe('Laptop');
    expect(impact.endWithout).toBe(60000);
    expect(impact.end).toBe(20000);
    expect(impact.endDifference).toBe(-40000);
  });

  it('reports no change when every draft is off', () => {
    const { data, main } = household();
    data.scenarios.push(makeScenario({ amount: 40000, date: '2026-10-20', accountId: main.id, active: false }));
    const impact = scenarioImpact(data, '2026-10-05', '2026-10-31');
    expect(impact.active).toBe(false);
    expect(impact.endDifference).toBe(0);
    expect(impact.lowest).toEqual(impact.lowestWithout);
  });
});
