import { describe, it, expect } from 'vitest';
import { Store, memoryAdapter } from '../src/store.js';
import {
  canSaveAhead, goalContribution, goalOutlook, monthlyNeeded, saveAheadDeadline, saveAheadGoal, saveAheadRoll
} from '../src/ledger.js';
import { emptyData, makeAccount, makeEntry, makeGoal, makeTemplate } from '../src/model.js';
import { entryFromTemplate, nextOccurrence } from '../src/schedule.js';

const TODAY = '2026-10-05';

function insurance(f = {}) {
  return makeTemplate({
    title: 'Car insurance', amount: 42000, schedule: { freq: 'yearly', day: 14, startDate: '2026-12-14' }, ...f
  });
}

describe('monthly amount needed', () => {
  it('spreads the sum over the payments left until the deadline, both days included', () => {
    expect(monthlyNeeded(42000, TODAY, '2026-12-14', 5)).toEqual({ amount: 14000, count: 3 });
    // On the 20th December is too late: two payments left.
    expect(monthlyNeeded(42000, TODAY, '2026-12-14', 20)).toEqual({ amount: 21000, count: 2 });
  });

  it('rounds up so the last payment does not fall short', () => {
    expect(monthlyNeeded(10000, TODAY, '2026-12-14', 5)).toEqual({ amount: 3334, count: 3 });
  });

  it('with no payment left the whole sum is due', () => {
    expect(monthlyNeeded(42000, TODAY, '2026-09-30', 5)).toEqual({ amount: 42000, count: 0 });
  });
});

describe('next deadline', () => {
  it('only payments that do not come every month are saved for', () => {
    expect(canSaveAhead(insurance())).toBe(true);
    expect(canSaveAhead(insurance({ schedule: { freq: 'everyNMonths', interval: 3, day: 1 } }))).toBe(true);
    expect(canSaveAhead(insurance({ schedule: { freq: 'monthly', day: 1 } }))).toBe(false);
    expect(canSaveAhead(insurance({ type: 'income' }))).toBe(false);
    expect(canSaveAhead(insurance({ isTransit: true }))).toBe(false);
  });

  it('is the open payment in the plan, or the next scheduled day', () => {
    const data = emptyData();
    const tpl = insurance();
    data.templates.push(tpl);
    expect(saveAheadDeadline(data, tpl, TODAY)).toBe('2026-12-14');
    // A payment moved in the plan keeps its new date.
    data.entries.push({ ...entryFromTemplate(tpl, '2026-12-14'), date: '2026-12-10' });
    expect(saveAheadDeadline(data, tpl, TODAY)).toBe('2026-12-10');
  });

  it('moves on once the payment is done or skipped', () => {
    const data = emptyData();
    const tpl = insurance();
    data.templates.push(tpl);
    const paid = { ...entryFromTemplate(tpl, '2026-12-14'), status: 'done' };
    data.entries.push(paid);
    expect(saveAheadDeadline(data, tpl, TODAY)).toBe('2027-12-14');
    paid.status = 'cancelled';
    expect(saveAheadDeadline(data, tpl, TODAY)).toBe('2027-12-14');
  });

  it('skips the zero rows of every-N-months payments shown every month', () => {
    const data = emptyData();
    const tpl = insurance({ amount: 6000, schedule: { freq: 'everyNMonths', interval: 3, day: 12, fillGaps: true, startDate: '2026-09-12' } });
    data.templates.push(tpl);
    ['2026-10-12', '2026-11-12', '2026-12-12'].forEach(d => data.entries.push(entryFromTemplate(tpl, d)));
    expect(saveAheadDeadline(data, tpl, TODAY)).toBe('2026-12-12');
    expect(nextOccurrence(tpl.schedule, TODAY)).toBe('2026-12-12');
  });

  it('a schedule that has ended has no next day', () => {
    expect(nextOccurrence({ freq: 'once', startDate: '2026-01-01' }, TODAY)).toBe(null);
  });
});

describe('roll over after the payment', () => {
  it('follows the payment: its amount is the target, its next occurrence the deadline', () => {
    const data = emptyData();
    const tpl = insurance();
    data.templates.push(tpl);
    const goal = makeGoal({ targetAmount: 42000, deadline: '2026-12-14', templateId: tpl.id });
    expect(saveAheadRoll(data, goal, TODAY)).toBe(null);
    tpl.amount = 45000;
    expect(saveAheadRoll(data, goal, TODAY)).toEqual({ deadline: '2026-12-14', targetAmount: 45000 });
    data.entries.push({ ...entryFromTemplate(tpl, '2026-12-14'), status: 'done' });
    expect(saveAheadRoll(data, goal, TODAY)).toEqual({ deadline: '2027-12-14', targetAmount: 45000 });
    expect(saveAheadRoll(data, { ...goal, archived: true }, TODAY)).toBe(null);
    expect(saveAheadRoll(data, { ...goal, templateId: null }, TODAY)).toBe(null);
  });

  it('the payment the goal saves for is not a loss in its outlook', () => {
    const data = emptyData();
    data.settings.trackingStart = '2026-10-01';
    const env = makeAccount({ name: 'Insurance', openingBalance: 42000 });
    data.accounts.push(env);
    const tpl = insurance({ accountId: env.id });
    data.templates.push(tpl);
    data.entries.push(entryFromTemplate(tpl, '2026-12-14'));
    const goal = makeGoal({ targetAmount: 42000, accountId: env.id, deadline: '2026-12-14', templateId: tpl.id });
    expect(goalOutlook(data, goal, TODAY).shortfall).toBe(0);
    // The same payment against an ordinary goal does take the money away.
    expect(goalOutlook(data, { ...goal, templateId: null }, TODAY).shortfall).toBe(42000);
  });
});

describe('saving ahead in the store', () => {
  function setup() {
    const store = new Store(memoryAdapter(), { today: () => TODAY });
    store.updateSettings({ trackingStart: '2026-10-01' });
    const main = store.add('accounts', makeAccount({ name: 'Main', openingBalance: 500000 }));
    const env = store.add('accounts', makeAccount({ name: 'Insurance', parentId: main.id, kind: 'savings' }));
    const tpl = insurance({ accountId: main.id });
    store.saveTemplate(tpl, { applyToFuture: false });
    const goal = store.startSaveAhead(tpl.id, { accountId: env.id, fromAccountId: main.id, day: 5, amount: 14000, contributionTitle: 'Saving for Car insurance' });
    const payment = () => store.list('entries').find(e => e.templateId === tpl.id && e.occurrence === '2026-12-14');
    return { store, main, env, tpl, goal, payment };
  }

  it('creates the goal and its contribution, and pays the payment from the goal account', () => {
    const { store, main, env, tpl, goal, payment } = setup();
    expect(goal).toMatchObject({ templateId: tpl.id, targetAmount: 42000, deadline: '2026-12-14', accountId: env.id, templateAccountId: main.id });
    expect(saveAheadGoal(store.data, tpl.id).id).toBe(goal.id);
    const c = goalContribution(store.data, goal);
    expect(c).toMatchObject({ type: 'transfer', amount: 14000, accountId: main.id, toAccountId: env.id });
    expect(c.schedule.endDate).toBe('2026-12-14');
    expect(store.list('entries').filter(e => e.templateId === c.id)).toHaveLength(3);
    expect(store.find('templates', tpl.id).accountId).toBe(env.id);
    expect(payment().accountId).toBe(env.id);
  });

  it('marking the payment done moves the goal on, undoing the mark moves it back', () => {
    const { store, goal, payment } = setup();
    const c = goalContribution(store.data, goal);
    store.list('entries').filter(e => e.templateId === c.id).forEach(e => store.setStatus(e.id, 'done', { today: TODAY }));
    store.setStatus(payment().id, 'done', { today: TODAY });
    const rolled = store.find('goals', goal.id);
    expect(rolled.deadline).toBe('2027-12-14');
    const next = goalContribution(store.data, rolled);
    expect(next.schedule.endDate).toBe('2027-12-14');
    // The envelope is empty again: 42000 over the 15 contributions to December 2027.
    expect(next.amount).toBe(2800);
    store.unmarkDone(payment().id);
    expect(store.find('goals', goal.id).deadline).toBe('2026-12-14');
    expect(goalContribution(store.data, goal).schedule.endDate).toBe('2026-12-14');
  });

  it('a new amount of the payment becomes the target', () => {
    const { store, tpl, goal } = setup();
    store.saveTemplate({ ...store.find('templates', tpl.id), amount: 45000 });
    expect(store.find('goals', goal.id).targetAmount).toBe(45000);
  });

  it('stopping archives the goal and hands the payment back', () => {
    const { store, main, tpl, goal, payment } = setup();
    store.stopSaveAhead(goal.id);
    expect(store.find('goals', goal.id).archived).toBe(true);
    expect(goalContribution(store.data, goal)).toBe(null);
    expect(store.find('templates', tpl.id).accountId).toBe(main.id);
    expect(payment().accountId).toBe(main.id);
    expect(saveAheadGoal(store.data, tpl.id)).toBe(null);
  });

  it('taking the goal back from the archive pays from its account again', () => {
    const { store, env, tpl, goal } = setup();
    store.stopSaveAhead(goal.id);
    store.resumeSaveAhead(goal.id);
    expect(store.find('goals', goal.id).archived).toBe(false);
    expect(store.find('templates', tpl.id).accountId).toBe(env.id);
  });

  it('removing the payment archives the goal without losing it', () => {
    const { store, tpl, goal } = setup();
    const c = goalContribution(store.data, goal);
    store.removeTemplate(tpl.id, { removeFuture: true });
    const kept = store.data.goals.find(g => g.id === goal.id);
    expect(kept).toMatchObject({ archived: true, deleted: false, targetAmount: 42000 });
    expect(store.find('templates', c.id)).toBe(null);
    expect(store.list('entries').filter(e => e.templateId === c.id)).toHaveLength(0);
  });

  it('a plain entry on the goal account does not move the goal', () => {
    const { store, env, goal } = setup();
    const e = store.add('entries', makeEntry({ date: TODAY, type: 'expense', amount: 100, accountId: env.id }));
    store.setStatus(e.id, 'done');
    expect(store.find('goals', goal.id).deadline).toBe('2026-12-14');
  });
});
