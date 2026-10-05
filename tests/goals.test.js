import { describe, it, expect } from 'vitest';
import { goalOutlook, goalProgress, raisedContribution, suggestedContribution } from '../src/ledger.js';
import { emptyData, makeAccount, makeEntry, makeGoal, makeTemplate } from '../src/model.js';
import { entryFromTemplate } from '../src/schedule.js';

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

describe('goal contribution in the plan', () => {
  // A trip for 2 000 by the end of March, 300 saved, a contribution of 200 on
  // the 10th: entries exist through December, January to March are still to
  // be generated.
  function withContribution() {
    const { data, main, holiday } = budget();
    const goal = makeGoal({ name: 'Trip', targetAmount: 200000, accountId: holiday.id, deadline: '2027-03-31' });
    data.goals.push(goal);
    const tpl = makeTemplate({
      title: 'Saving for Trip', type: 'transfer', amount: 20000, accountId: main.id, toAccountId: holiday.id, goalId: goal.id,
      schedule: { freq: 'monthly', day: 10, startDate: '2026-10-05', endDate: '2027-03-31' }
    });
    tpl.generatedThrough = '2026-12-31';
    data.templates.push(tpl);
    ['2026-10-10', '2026-11-10', '2026-12-10'].forEach(day => data.entries.push(entryFromTemplate(tpl, day)));
    return { data, main, holiday, goal, tpl };
  }

  it('keeps the link to its goal', () => {
    expect(makeTemplate({ goalId: 'g1' }).goalId).toBe('g1');
    expect(makeTemplate({}).goalId).toBe(null);
  });

  it('expects the envelope by the deadline from the plan, generated or not yet', () => {
    const { data, holiday, goal, tpl } = withContribution();
    // Spending from the envelope before the deadline counts, after it does not.
    data.entries.push(makeEntry({ date: '2027-02-01', type: 'expense', amount: 10000, accountId: holiday.id, status: 'planned' }));
    data.entries.push(makeEntry({ date: '2027-05-01', type: 'income', amount: 99900, accountId: holiday.id, status: 'planned' }));
    const o = goalOutlook(data, goal, '2026-10-05');
    expect(o.contribution.id).toBe(tpl.id);
    expect(o.projected).toBe(30000 + 6 * 20000 - 10000);
    expect(o.shortfall).toBe(60000);
    expect(o.contributionsLeft).toBe(6);
    expect(raisedContribution(o)).toBe(30000);
  });

  it('suggests the monthly amount on top of the rest of the plan', () => {
    const { data, goal, tpl } = withContribution();
    // In place of the current contribution: 1 700 over six payments.
    expect(suggestedContribution(data, goal, '2026-10-05', 10, tpl.id)).toEqual({ amount: 28334, count: 6, need: 170000 });
    // On the 3rd the October payment is already past.
    expect(suggestedContribution(data, goal, '2026-10-05', 3, tpl.id)).toMatchObject({ count: 5, amount: 34000 });
    // With the contribution kept, 500 is still missing.
    expect(suggestedContribution(data, goal, '2026-10-05', 10).need).toBe(50000);
  });

  it('a goal on track needs no raise, one without a deadline has no outlook', () => {
    const { data, goal } = withContribution();
    goal.targetAmount = 150000;
    const o = goalOutlook(data, goal, '2026-10-05');
    expect(o.shortfall).toBe(0);
    expect(raisedContribution(o)).toBe(null);
    const open = goalOutlook(data, { ...goal, deadline: null }, '2026-10-05');
    expect(open.projected).toBe(null);
    expect(raisedContribution(open)).toBe(null);
  });
});
