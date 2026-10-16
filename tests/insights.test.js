import { describe, it, expect } from 'vitest';
import { budgetAlerts, runway } from '../src/ledger.js';
import { emptyData, makeAccount, makeCategory, makeEntry, makeGoal, normalizeData, DEFAULT_SETTINGS } from '../src/model.js';
import { daysBetween } from '../src/dates.js';
import { parseLinkAmount, parseQuickLink, stripQuickParams, quickLinkBase } from '../src/quicklink.js';
import { buildDemo } from '../src/demo.js';

const TODAY = '2026-10-16';

function budget(opening = 300000) {
  const data = emptyData();
  data.settings.trackingStart = '2026-01-01';
  const acc = makeAccount({ name: 'Main', openingBalance: opening });
  const other = makeAccount({ name: 'Second account' });
  const food = makeCategory({ name: 'Food', type: 'expense' });
  const salary = makeCategory({ name: 'Salary', type: 'income' });
  data.accounts.push(acc, other);
  data.categories.push(food, salary);
  const add = (f) => { const e = makeEntry({ accountId: acc.id, status: 'done', type: 'expense', ...f }); data.entries.push(e); return e; };
  return { data, acc, other, food, salary, add };
}

describe('dates', () => {
  it('counts whole days between day keys, across a clock change', () => {
    expect(daysBetween('2026-10-16', '2026-10-16')).toBe(0);
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-16', '2026-10-15')).toBe(-1);
  });
});

describe('runway', () => {
  it('divides free money by the average daily spending of the last 90 days', () => {
    const { data, add } = budget(300000);
    // 90 days back from 2026-10-16 is 2026-07-19 on.
    add({ date: '2026-07-01', amount: 999999, type: 'income' });
    add({ date: '2026-07-10', amount: 50000 }); // older than the window
    add({ date: '2026-08-01', amount: 45000 });
    add({ date: '2026-10-01', amount: 45000 });
    const r = runway(data, TODAY);
    expect(r.historyDays).toBe(90);
    expect(r.spent).toBe(90000);
    expect(r.daily).toBe(1000);
    expect(r.free).toBe(300000 + 999999 - 50000 - 90000);
    expect(r.status).toBe('ok');
    expect(r.days).toBe(Math.floor(r.free / 1000));
  });

  it('averages a short history over its own length', () => {
    const { data, add } = budget(100000);
    add({ date: '2026-10-07', amount: 10000 });
    const r = runway(data, TODAY);
    expect(r.historyDays).toBe(10);
    expect(r.daily).toBe(1000);
    expect(r.days).toBe(90);
  });

  it('counts only real flows of the budget, not plans, transit, adjustments or own transfers', () => {
    const { data, acc, other, add } = budget(100000);
    add({ date: '2026-09-01', amount: 9000 });
    add({ date: '2026-10-10', amount: 50000, status: 'planned' });
    add({ date: '2026-10-20', amount: 50000, status: 'planned' });
    add({ date: '2026-10-01', amount: 30000, isTransit: true });
    add({ date: '2026-10-02', amount: 4000, isAdjustment: true });
    add({ date: '2026-10-03', amount: 20000, status: 'cancelled' });
    add({ date: '2026-10-04', amount: 70000, type: 'transfer', accountId: acc.id, toAccountId: other.id });
    const r = runway(data, TODAY);
    expect(r.spent).toBe(9000);
  });

  it('counts money put aside for a goal as spending, as the budget sees it', () => {
    const { data, acc, add } = budget(100000);
    const piggy = makeAccount({ name: 'Holiday' });
    data.accounts.push(piggy);
    data.goals.push(makeGoal({ name: 'Trip', targetAmount: 100000, accountId: piggy.id }));
    add({ date: '2026-07-19', amount: 9000, type: 'transfer', accountId: acc.id, toAccountId: piggy.id });
    const r = runway(data, TODAY);
    expect(r.spent).toBe(9000);
    expect(r.daily).toBe(100);
    expect(r.free).toBe(91000);
    expect(r.days).toBe(910);
  });

  it('says there is no history or no spending instead of infinity', () => {
    const empty = budget(100000);
    expect(runway(empty.data, TODAY)).toMatchObject({ status: 'no-history', days: null, daily: 0 });
    const incomeOnly = budget(100000);
    incomeOnly.add({ date: '2026-10-01', amount: 200000, type: 'income' });
    expect(runway(incomeOnly.data, TODAY)).toMatchObject({ status: 'no-spending', days: null, spent: 0 });
  });

  it('has no runway when free money is below zero', () => {
    const { data, add } = budget(1000);
    add({ date: '2026-10-01', amount: 5000 });
    const r = runway(data, TODAY);
    expect(r.free).toBe(-4000);
    expect(r.status).toBe('negative');
    expect(r.days).toBe(null);
  });

  it('leaves out what is dated after today', () => {
    const { data, add } = budget(100000);
    add({ date: '2026-10-06', amount: 10000 });
    add({ date: '2026-10-30', amount: 50000 });
    expect(runway(data, TODAY).spent).toBe(10000);
  });
});

describe('alerts', () => {
  it('warns about a category at 80% and at 100% of its monthly limit', () => {
    const { data, food, add } = budget(500000);
    food.monthlyLimit = 10000;
    const fun = makeCategory({ name: 'Fun', type: 'expense', monthlyLimit: 10000 });
    const kids = makeCategory({ name: 'Kids', type: 'expense', monthlyLimit: 10000 });
    data.categories.push(fun, kids);
    add({ date: '2026-10-02', amount: 8000, categoryId: food.id });
    add({ date: '2026-10-03', amount: 10500, categoryId: fun.id });
    add({ date: '2026-10-04', amount: 7900, categoryId: kids.id });
    add({ date: '2026-09-04', amount: 9000, categoryId: kids.id }); // last month
    const alerts = budgetAlerts(data, TODAY);
    const near = alerts.find(a => a.kind === 'limit-near');
    const over = alerts.find(a => a.kind === 'limit-over');
    expect(near).toMatchObject({ categoryId: food.id, percent: 80, spent: 8000, limit: 10000, level: 'warning' });
    expect(over).toMatchObject({ categoryId: fun.id, percent: 105, level: 'danger' });
    expect(alerts.some(a => a.categoryId === kids.id)).toBe(false);
    expect(near.key).toBe(`limit-near:${food.id}:2026-10`);
  });

  it('warns when free money is below the threshold', () => {
    const { data } = budget(5000);
    data.settings.alertFreeBelow = 10000;
    expect(budgetAlerts(data, TODAY).find(a => a.kind === 'free-low')).toMatchObject({ free: 5000, threshold: 10000, level: 'warning' });
    data.settings.alertFreeBelow = 5000;
    expect(budgetAlerts(data, TODAY).some(a => a.kind === 'free-low')).toBe(false);
    data.settings.alertFreeBelow = null;
    expect(budgetAlerts(data, TODAY).some(a => a.kind === 'free-low')).toBe(false);
    data.settings.alertFreeBelow = 0;
    data.accounts[0].openingBalance = -100;
    expect(budgetAlerts(data, TODAY).find(a => a.kind === 'free-low')).toMatchObject({ level: 'danger' });
  });

  it('warns about large payments in the next three days', () => {
    const { data, add } = budget(500000);
    data.settings.alertLargePayment = 50000;
    const rent = add({ date: '2026-10-18', amount: 95000, status: 'planned', title: 'Rent' });
    const insurance = add({ date: '2026-10-19', amount: 60000, status: 'reserved', title: 'Insurance' });
    add({ date: '2026-10-20', amount: 90000, status: 'planned' }); // 4 days ahead
    add({ date: '2026-10-17', amount: 50000, status: 'planned' }); // not above
    add({ date: '2026-10-17', amount: 90000, status: 'done' });
    add({ date: '2026-10-17', amount: 90000, status: 'planned', isTransit: true });
    add({ date: '2026-10-17', amount: 90000, status: 'planned', type: 'income' });
    const large = budgetAlerts(data, TODAY).filter(a => a.kind === 'large-payment');
    expect(large.map(a => a.entryId)).toEqual([rent.id, insurance.id]);
    expect(large[1]).toMatchObject({ reserved: true, amount: 60000, date: '2026-10-19' });
    data.settings.alertLargePayment = null;
    expect(budgetAlerts(data, TODAY).some(a => a.kind === 'large-payment')).toBe(false);
  });

  it('is silent when switched off or when there are no accounts yet', () => {
    const { data, food, add } = budget(0);
    food.monthlyLimit = 1000;
    add({ date: '2026-10-02', amount: 2000, categoryId: food.id });
    expect(budgetAlerts(data, TODAY).length).toBeGreaterThan(0);
    data.settings.alertsEnabled = false;
    expect(budgetAlerts(data, TODAY)).toEqual([]);
    expect(budgetAlerts(emptyData(), TODAY)).toEqual([]);
  });

  it('has defaults, also for documents saved before alerts existed', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ alertsEnabled: true, alertFreeBelow: 10000, alertLargePayment: 50000 });
    const old = normalizeData({ settings: { language: 'en' }, entries: [] });
    expect(old.settings.alertsEnabled).toBe(true);
    expect(old.settings.alertLargePayment).toBe(50000);
  });

  it('gives the demo a category close to its limit', () => {
    const demo = buildDemo('2026-10-25', 'en');
    expect(demo.categories.filter(c => c.monthlyLimit).length).toBe(2);
    expect(budgetAlerts(demo, '2026-10-25').some(a => a.kind === 'limit-near')).toBe(true);
  });
});

describe('quick entry link', () => {
  const { data, acc, food, salary } = budget();

  it('reads type, amount and note', () => {
    expect(parseQuickLink('?quick=expense&amount=12.50&note=Lidl', data))
      .toEqual({ type: 'expense', amount: 1250, note: 'Lidl', categoryId: null, accountId: null });
    expect(parseQuickLink('?quick=income&amount=200', data)).toMatchObject({ type: 'income', amount: 20000, note: '' });
    expect(parseQuickLink('?quick=Expense&amount=12,5', data)).toMatchObject({ type: 'expense', amount: 1250 });
    expect(parseQuickLink('?quick=expense&note=Caf%C3%A9%20Central', data).note).toBe('Café Central');
  });

  it('opens nothing without a known type', () => {
    expect(parseQuickLink('', data)).toBe(null);
    expect(parseQuickLink('?amount=12', data)).toBe(null);
    expect(parseQuickLink('?quick=transfer&amount=12', data)).toBe(null);
  });

  it('leaves a bad amount empty', () => {
    expect(parseQuickLink('?quick=expense&amount=abc', data).amount).toBe(null);
    expect(parseQuickLink('?quick=expense&amount=-5', data).amount).toBe(null);
    expect(parseQuickLink('?quick=expense&amount=0', data).amount).toBe(null);
    expect(parseQuickLink('?quick=expense', data).amount).toBe(null);
  });

  it('takes amounts the way Wallet passes them', () => {
    expect(parseLinkAmount('€12.50')).toBe(1250);
    expect(parseLinkAmount('12,50 €')).toBe(1250);
    expect(parseLinkAmount('EUR 1 234,56')).toBe(123456);
    expect(parseLinkAmount('1.234,56')).toBe(123456);
    expect(parseLinkAmount(null)).toBe(null);
  });

  it('matches category and account by name, ignoring case, for the right type', () => {
    const q = parseQuickLink('?quick=expense&category=food&account=%20MAIN%20', data);
    expect(q.categoryId).toBe(food.id);
    expect(q.accountId).toBe(acc.id);
    expect(parseQuickLink('?quick=income&category=SALARY', data).categoryId).toBe(salary.id);
    expect(parseQuickLink('?quick=income&category=Food', data).categoryId).toBe(null);
    expect(parseQuickLink('?quick=expense&category=Nothing&account=Nowhere', data)).toMatchObject({ categoryId: null, accountId: null });
  });

  it('removes only its own parameters from the address', () => {
    expect(stripQuickParams('https://example.org/app/?quick=expense&amount=12.50&note=Lidl')).toBe('/app/');
    expect(stripQuickParams('https://example.org/app/?quick=income&x=1#day=2026-10-16')).toBe('/app/?x=1#day=2026-10-16');
    expect(quickLinkBase('https://example.org/app/')).toBe('https://example.org/app/?quick=expense');
  });
});
