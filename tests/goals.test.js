import { describe, it, expect } from 'vitest';
import { goalProgress } from '../src/ledger.js';
import { emptyData, makeAccount, makeEntry, makeGoal } from '../src/model.js';

function budget() {
  const data = emptyData();
  data.settings.trackingStart = '2026-10-01';
  const main = makeAccount({ name: 'Main', openingBalance: 500000 });
  const holiday = makeAccount({ name: 'Holiday', parentId: main.id, openingBalance: 30000 });
  data.accounts.push(main, holiday);
  return { data, main, holiday };
}

describe('goal progress', () => {
  it('counts the envelope, the rest and the monthly amount until the deadline', () => {
    const { data, holiday } = budget();
    data.entries.push(makeEntry({ date: '2026-10-02', type: 'transfer', amount: 20000, accountId: data.accounts[0].id, toAccountId: holiday.id, status: 'done' }));
    const goal = makeGoal({ name: 'Trip', targetAmount: 200000, accountId: holiday.id, deadline: '2027-03-31' });
    const p = goalProgress(data, goal, '2026-10-05');
    expect(p.saved).toBe(50000);
    expect(p.remaining).toBe(150000);
    expect(p.percent).toBe(25);
    expect(p.monthsLeft).toBe(6); // October to March
    expect(p.perMonth).toBe(25000);
    expect(p.late).toBe(false);
  });

  it('a goal past its deadline asks for the whole rest, a reached one for nothing', () => {
    const { data, holiday } = budget();
    const late = goalProgress(data, makeGoal({ targetAmount: 100000, accountId: holiday.id, deadline: '2026-09-30' }), '2026-10-05');
    expect(late).toMatchObject({ monthsLeft: 0, perMonth: 70000, late: true });
    const done = goalProgress(data, makeGoal({ targetAmount: 20000, accountId: holiday.id }), '2026-10-05');
    expect(done).toMatchObject({ reached: true, remaining: 0, percent: 100, perMonth: null });
  });

  it('an account with envelopes counts the whole group', () => {
    const { data, main } = budget();
    const p = goalProgress(data, makeGoal({ targetAmount: 1000000, accountId: main.id }), '2026-10-05');
    expect(p.saved).toBe(530000);
  });
});
