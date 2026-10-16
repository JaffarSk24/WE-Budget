import { describe, it, expect } from 'vitest';
import { debtOutlook, debtPayments, debtState, monthsElapsed, nextPaymentMonth, payoffPlan, payoffSchedule, planDebts } from '../src/debts.js';
import { emptyData, makeAccount, makeDebt, makeEntry, makeTemplate, normalizeData, COLLECTIONS } from '../src/model.js';

function budget() {
  const data = emptyData();
  const main = makeAccount({ name: 'Main', openingBalance: 500000 });
  data.accounts.push(main);
  return { data, main };
}

const pay = (f) => makeEntry({ type: 'expense', status: 'done', ...f });

describe('debts in the model', () => {
  it('is a collection with defaults, and old documents load without it', () => {
    expect(COLLECTIONS).toContain('debts');
    const d = makeDebt({ name: 'Car', original: 1200000 });
    expect(d.kind).toBe('owe');
    expect(d.balance).toBe(1200000);
    expect(d.rate).toBe(0);
    expect(d.archived).toBe(false);
    expect(normalizeData({ accounts: [] }).debts).toEqual([]);
    expect(makeEntry({ date: '2026-10-01' }).debtId).toBe(null);
    expect(makeTemplate({ debtId: 'x' }).debtId).toBe('x');
  });
});

describe('monthsElapsed', () => {
  it('counts a calendar month as one, and parts of a month by days', () => {
    expect(monthsElapsed('2026-01-10', '2026-02-10')).toBe(1);
    expect(monthsElapsed('2026-01-10', '2026-01-25')).toBeCloseTo(0.5);
    expect(monthsElapsed('2026-03-10', '2026-03-01')).toBe(0);
    expect(monthsElapsed(null, '2026-03-01')).toBe(0);
  });
});

describe('debtState', () => {
  it('without interest every payment brings the balance down', () => {
    const { data, main } = budget();
    const debt = makeDebt({ name: 'Friend', original: 100000, balanceDate: '2026-01-01' });
    data.debts.push(debt);
    data.entries.push(pay({ date: '2026-02-01', amount: 30000, accountId: main.id, debtId: debt.id }));
    data.entries.push(pay({ date: '2026-03-01', amount: 15000, accountId: main.id, debtId: debt.id }));
    const s = debtState(data, debt, '2026-03-15');
    expect(s.remaining).toBe(55000);
    expect(s.paid).toBe(45000);
    expect(s.interestPaid).toBe(0);
    expect(s.percent).toBe(45);
    expect(s.payments).toBe(2);
    expect(s.lastPayment).toBe('2026-03-01');
  });

  it('a payment first covers the interest since the previous one', () => {
    const { data, main } = budget();
    // 12% a year = 1% a month.
    const debt = makeDebt({ name: 'Loan', original: 1000000, rate: 12, balanceDate: '2026-01-10' });
    data.debts.push(debt);
    data.entries.push(pay({ date: '2026-02-10', amount: 50000, accountId: main.id, debtId: debt.id }));
    data.entries.push(pay({ date: '2026-03-10', amount: 50000, accountId: main.id, debtId: debt.id }));
    const s = debtState(data, debt, '2026-03-20');
    // 10 000 + 100 - 500 = 9 600; 9 600 + 96 - 500 = 9 196.
    expect(s.remaining).toBe(919600);
    expect(s.interestPaid).toBe(10000 + 9600);
    expect(s.principalPaid).toBe(80400);
    expect(s.percent).toBe(8);
  });

  it('starts from the last balance checkpoint and ignores payments before it', () => {
    const { data, main } = budget();
    const debt = makeDebt({ name: 'Loan', original: 1200000, balance: 800000, balanceDate: '2026-05-10' });
    data.debts.push(debt);
    data.entries.push(pay({ date: '2026-04-10', amount: 28000, accountId: main.id, debtId: debt.id }));
    data.entries.push(pay({ date: '2026-06-10', amount: 28000, accountId: main.id, debtId: debt.id }));
    const s = debtState(data, debt, '2026-06-20');
    expect(s.remaining).toBe(772000);
    expect(s.percent).toBe(35); // (12 000 - 7 720) / 12 000 = 35.6%
  });

  it('counts done entries of the linked template, not planned ones or other debts', () => {
    const { data, main } = budget();
    const tpl = makeTemplate({ title: 'Car loan', amount: 20000, accountId: main.id });
    const debt = makeDebt({ name: 'Car', original: 100000, templateId: tpl.id, balanceDate: '2026-01-01' });
    data.templates.push(tpl);
    data.debts.push(debt);
    data.entries.push(pay({ date: '2026-02-01', amount: 20000, accountId: main.id, templateId: tpl.id }));
    data.entries.push(makeEntry({ date: '2026-03-01', amount: 20000, accountId: main.id, templateId: tpl.id, status: 'planned' }));
    data.entries.push(pay({ date: '2026-02-05', amount: 20000, accountId: main.id, templateId: tpl.id, debtId: 'other' }));
    const deleted = pay({ date: '2026-02-06', amount: 20000, accountId: main.id, debtId: debt.id });
    deleted.deleted = true;
    data.entries.push(deleted);
    expect(debtPayments(data, debt).length).toBe(1);
    expect(debtState(data, debt, '2026-03-15').remaining).toBe(80000);
  });

  it('a payment too small for the interest leaves the rest on the debt; overpaying stops at zero', () => {
    const { data, main } = budget();
    const debt = makeDebt({ name: 'Card', original: 100000, rate: 24, balanceDate: '2026-01-01' });
    data.debts.push(debt);
    data.entries.push(pay({ date: '2026-02-01', amount: 1000, accountId: main.id, debtId: debt.id }));
    let s = debtState(data, debt, '2026-02-02');
    expect(s.remaining).toBe(101000); // 2 000 interest, 1 000 paid
    expect(s.interestPaid).toBe(1000);
    expect(s.percent).toBe(0);
    data.entries.push(pay({ date: '2026-02-01', amount: 500000, accountId: main.id, debtId: debt.id }));
    s = debtState(data, debt, '2026-02-02');
    expect(s.remaining).toBe(0);
    expect(s.percent).toBe(100);
    expect(s.paidOff).toBe(true);
  });

  it('works the same for money someone owes me', () => {
    const { data, main } = budget();
    const debt = makeDebt({ name: 'Lent to Ivo', kind: 'owed', original: 40000, balanceDate: '2026-01-01' });
    data.debts.push(debt);
    data.entries.push(makeEntry({ type: 'income', status: 'done', date: '2026-02-01', amount: 10000, accountId: main.id, debtId: debt.id }));
    const s = debtState(data, debt, '2026-02-02');
    expect(s.remaining).toBe(30000);
    expect(s.percent).toBe(25);
  });
});

describe('payoffSchedule', () => {
  it('pays a loan off month by month with the interest on top', () => {
    const s = payoffSchedule(100000, 12, 50000, '2026-11');
    expect(s.never).toBe(false);
    expect(s.months).toBe(3);
    expect(s.payoffMonth).toBe('2027-01');
    // 1 000 + 1 000 + 500 = 1 000 interest, then 510 interest, then 5 cents more.
    expect(s.rows.map(r => r.interest)).toEqual([1000, 510, 15]);
    expect(s.totalInterest).toBe(1525);
    expect(s.rows[2].payment).toBe(1525);
    expect(s.totalPaid).toBe(101525);
  });

  it('without interest is a plain division', () => {
    const s = payoffSchedule(100000, 0, 30000, '2026-11');
    expect(s.months).toBe(4);
    expect(s.totalInterest).toBe(0);
    expect(s.payoffMonth).toBe('2027-02');
  });

  it('detects a payment that does not cover the interest', () => {
    const s = payoffSchedule(1000000, 12, 10000, '2026-11');
    expect(s.never).toBe(true);
    expect(s.payoffMonth).toBe(null);
    expect(payoffSchedule(1000000, 12, 0, '2026-11').never).toBe(true);
  });

  it('a paid off debt has nothing left to schedule', () => {
    const s = payoffSchedule(0, 5, 10000, '2026-11');
    expect(s.months).toBe(0);
    expect(s.never).toBe(false);
  });
});

describe('debtOutlook', () => {
  it('starts the schedule next month once this month is paid', () => {
    const { data, main } = budget();
    const debt = makeDebt({ name: 'Loan', original: 60000, payment: 20000, balanceDate: '2026-09-01' });
    data.debts.push(debt);
    data.entries.push(pay({ date: '2026-10-05', amount: 20000, accountId: main.id, debtId: debt.id }));
    const o = debtOutlook(data, debt, '2026-10-16');
    expect(o.remaining).toBe(40000);
    expect(o.schedule.payoffMonth).toBe('2026-12');
    expect(nextPaymentMonth({ lastPayment: '2026-09-05' }, '2026-10-16')).toBe('2026-10');
  });
});

describe('payoffPlan', () => {
  const debts = [
    { id: 'a', name: 'Card', balance: 200000, rate: 20, payment: 10000 },
    { id: 'b', name: 'Car', balance: 800000, rate: 6, payment: 25000 },
    { id: 'c', name: 'Friend', balance: 50000, rate: 0, payment: 5000 }
  ];

  it('avalanche pays the highest rate first, snowball the smallest balance', () => {
    const av = payoffPlan(debts, 20000, 'avalanche', '2026-11');
    expect(av.order.map(d => d.id)).toEqual(['a', 'b', 'c']);
    const sb = payoffPlan(debts, 20000, 'snowball', '2026-11');
    expect(sb.order.map(d => d.id)).toEqual(['c', 'a', 'b']);
    // Avalanche never costs more interest than snowball.
    expect(av.totalInterest).toBeLessThanOrEqual(sb.totalInterest);
    // Every debt has its payoff month, the plan ends with the last one.
    av.order.forEach(d => expect(d.payoffMonth).toMatch(/^\d{4}-\d{2}$/));
    expect(av.payoffMonth).toBe([...av.order.map(d => d.payoffMonth)].sort().pop());
  });

  it('saves months and interest versus paying only the payments', () => {
    const p = payoffPlan(debts, 20000, 'avalanche', '2026-11');
    expect(p.budget).toBe(60000);
    expect(p.monthsSaved).toBeGreaterThan(0);
    expect(p.interestSaved).toBeGreaterThan(0);
    expect(p.baseline.months).toBe(p.months + p.monthsSaved);
    expect(p.baseline.totalInterest).toBe(p.totalInterest + p.interestSaved);
  });

  it('with one interest free debt and no extra it matches the plain schedule', () => {
    const p = payoffPlan([{ id: 'x', name: 'X', balance: 100000, rate: 0, payment: 25000 }], 0, 'snowball', '2026-11');
    expect(p.months).toBe(4);
    expect(p.monthsSaved).toBe(0);
    expect(p.interestSaved).toBe(0);
    expect(p.order[0].payoffMonth).toBe('2027-02');
  });

  it('reports a plan that never pays off', () => {
    const p = payoffPlan([{ id: 'x', name: 'X', balance: 1000000, rate: 24, payment: 10000 }], 5000, 'avalanche', '2026-11');
    expect(p.never).toBe(true);
    expect(p.monthsSaved).toBe(null);
    expect(p.baseline.never).toBe(true);
    // Enough extra money fixes it.
    const q = payoffPlan([{ id: 'x', name: 'X', balance: 1000000, rate: 24, payment: 10000 }], 40000, 'avalanche', '2026-11');
    expect(q.never).toBe(false);
    expect(q.baseline.never).toBe(true);
    expect(q.monthsSaved).toBe(null);
  });

  it('planDebts takes open loans with something left', () => {
    const { data } = budget();
    data.debts.push(makeDebt({ name: 'Loan', original: 100000, rate: 5, payment: 10000, balanceDate: '2026-01-01' }));
    data.debts.push(makeDebt({ name: 'Owed to me', kind: 'owed', original: 100000 }));
    data.debts.push(makeDebt({ name: 'Old', original: 100000, archived: true }));
    data.debts.push(makeDebt({ name: 'Done', original: 100000, balance: 0 }));
    const list = planDebts(data, '2026-10-16');
    expect(list.map(d => d.name)).toEqual(['Loan']);
    expect(list[0]).toMatchObject({ balance: 100000, rate: 5, payment: 10000 });
  });
});

describe('demo debts', () => {
  it('has a car loan paid by its recurring payment and a small debt owed', async () => {
    const { buildDemo } = await import('../src/demo.js');
    const data = buildDemo('2026-10-16', 'en');
    const car = data.debts.find(d => d.kind === 'owe');
    const lent = data.debts.find(d => d.kind === 'owed');
    expect(data.templates.find(x => x.id === car.templateId).debtId).toBe(car.id);
    const s = debtState(data, car, '2026-10-16');
    expect(s.payments).toBeGreaterThan(0);
    expect(s.percent).toBeGreaterThan(s.payments > 0 ? 26 : 0);
    expect(debtOutlook(data, car, '2026-10-16').schedule.never).toBe(false);
    expect(debtState(data, lent, '2026-10-16').remaining).toBe(30000);
  });
});
