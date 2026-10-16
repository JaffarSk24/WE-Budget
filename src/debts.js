// Loans and debts: what is left to pay (or to get back), how much interest
// is still to come, when it will be paid off, and in which order to pay
// several debts off with extra money. Pure functions over the data document,
// amounts in integer cents, rates in % a year. debtState is the one place
// that says what a debt still amounts to, so other screens (net worth later)
// read it from here.

import { live } from './model.js';
import { addMonthsToMonth, monthOf, monthsBetween } from './dates.js';

// Longest schedule worked out (100 years); a payment that never pays the
// debt off stops here instead of looping forever.
const MAX_MONTHS = 1200;

export function monthlyRate(annualRate) {
  return Math.max(0, Number(annualRate) || 0) / 100 / 12;
}

// Months from one day to another, counted the way a bank charges interest:
// whole calendar months, plus the difference in days as a share of a month.
// The 10th to the 10th of the next month is exactly one month.
export function monthsElapsed(from, to) {
  if (!from || to <= from) return 0;
  const whole = monthsBetween(monthOf(from), monthOf(to));
  const days = Number(to.slice(8, 10)) - Number(from.slice(8, 10));
  return Math.max(0, whole + days / 30);
}

// Payments that count for a debt: done entries marked with the debt, and
// done entries of its recurring payment (unless marked with another debt).
export function debtPayments(data, debt, today = null) {
  return live(data.entries)
    .filter(e => e.status === 'done' && (!today || e.date <= today)
      && (e.debtId === debt.id || (!e.debtId && debt.templateId && e.templateId === debt.templateId)))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
}

// Where a debt stands today. Starts from the last known balance (the
// checkpoint) and goes through the payments made after it: each payment
// first covers the interest accrued since the previous one at the monthly
// rate, the rest brings the principal down. A payment too small for the
// interest leaves the rest of the interest on the debt.
export function debtState(data, debt, today) {
  const original = debt.original || 0;
  const checkpoint = debt.balanceDate || null;
  const rate = monthlyRate(debt.rate);
  let remaining = Math.max(0, debt.balance ?? original);
  let paid = 0;
  let interestPaid = 0;
  let last = checkpoint;
  const payments = debtPayments(data, debt, today).filter(e => !checkpoint || e.date > checkpoint);
  payments.forEach(e => {
    const amount = Math.max(0, e.amount || 0);
    const interest = last && remaining > 0 ? Math.round(remaining * rate * monthsElapsed(last, e.date)) : 0;
    const toInterest = Math.min(amount, interest);
    remaining = Math.max(0, remaining + interest - amount);
    paid += amount;
    interestPaid += toInterest;
    last = e.date;
  });
  const principalPaid = Math.max(0, original - remaining);
  const percent = original > 0 ? Math.min(100, Math.max(0, Math.floor((principalPaid / original) * 100))) : (remaining === 0 ? 100 : 0);
  return {
    original, remaining, paid, interestPaid, principalPaid, percent,
    payments: payments.length,
    lastPayment: payments.length ? payments[payments.length - 1].date : null,
    paidOff: remaining === 0
  };
}

// Month by month until the balance is paid off: interest at the monthly
// rate, then the payment (the last one only what is left). `never` is set
// when the payment does not even cover the first month's interest.
export function payoffSchedule(balance, annualRate, payment, startMonth) {
  const rate = monthlyRate(annualRate);
  const rows = [];
  let left = Math.max(0, balance || 0);
  let totalInterest = 0;
  let totalPaid = 0;
  if (left === 0) return { rows, months: 0, totalInterest: 0, totalPaid: 0, payoffMonth: null, never: false };
  const firstInterest = Math.round(left * rate);
  if (!(payment > 0) || payment <= firstInterest) {
    return { rows, months: null, totalInterest: null, totalPaid: null, payoffMonth: null, never: true, firstInterest };
  }
  let month = startMonth;
  while (left > 0 && rows.length < MAX_MONTHS) {
    const interest = Math.round(left * rate);
    const pay = Math.min(payment, left + interest);
    left = left + interest - pay;
    totalInterest += interest;
    totalPaid += pay;
    rows.push({ month, payment: pay, interest, principal: pay - interest, balance: left });
    month = addMonthsToMonth(month, 1);
  }
  const done = left === 0;
  return {
    rows, months: done ? rows.length : null, totalInterest, totalPaid,
    payoffMonth: done ? rows[rows.length - 1].month : null, never: !done
  };
}

// The month the next payment goes to: next month when this month's payment
// has been made already, otherwise this one.
export function nextPaymentMonth(state, today) {
  const month = monthOf(today);
  return state.lastPayment && monthOf(state.lastPayment) === month ? addMonthsToMonth(month, 1) : month;
}

// A debt today and at its current payment: state plus the payoff schedule.
export function debtOutlook(data, debt, today) {
  const state = debtState(data, debt, today);
  const schedule = payoffSchedule(state.remaining, debt.rate, debt.payment, nextPaymentMonth(state, today));
  return { ...state, schedule };
}

function orderDebts(debts, strategy) {
  const list = debts.slice();
  if (strategy === 'snowball') {
    list.sort((a, b) => a.balance - b.balance || b.rate - a.rate || String(a.name).localeCompare(String(b.name)));
  } else {
    list.sort((a, b) => b.rate - a.rate || a.balance - b.balance || String(a.name).localeCompare(String(b.name)));
  }
  return list;
}

// Pays several debts off together: every month each debt gets its own
// payment (at most what it still needs), and everything else of the monthly
// budget, the extra amount plus the payments of debts already paid off,
// goes to the first unpaid debt in strategy order.
function simulate(debts, budget, strategy) {
  const order = orderDebts(debts, strategy);
  const state = order.map(d => ({ ...d, left: d.balance, interest: 0, months: null }));
  let month = 0;
  let totalInterest = 0;
  while (state.some(d => d.left > 0) && month < MAX_MONTHS) {
    month += 1;
    const before = state.reduce((s, d) => s + d.left, 0);
    let pot = budget;
    state.forEach(d => {
      if (d.left <= 0) return;
      const interest = Math.round(d.left * monthlyRate(d.rate));
      d.left += interest;
      d.interest += interest;
      totalInterest += interest;
    });
    state.forEach(d => {
      if (d.left <= 0) return;
      const pay = Math.min(d.payment, d.left, pot);
      d.left -= pay;
      pot -= pay;
    });
    state.forEach(d => {
      if (d.left <= 0 || pot <= 0) return;
      const pay = Math.min(d.left, pot);
      d.left -= pay;
      pot -= pay;
    });
    state.forEach(d => { if (d.left <= 0 && d.months === null) d.months = month; });
    const after = state.reduce((s, d) => s + d.left, 0);
    if (after >= before) break; // the interest eats the whole budget
  }
  const never = state.some(d => d.left > 0);
  return {
    order: state.map(d => ({ id: d.id, name: d.name, balance: d.balance, rate: d.rate, months: d.months, interest: d.interest })),
    months: never ? null : month,
    totalInterest: never ? null : totalInterest,
    never
  };
}

// A plan for several debts. `debts`: [{ id, name, balance, rate, payment }]
// (cents, % a year). 'avalanche' pays the highest rate first (least
// interest), 'snowball' the smallest balance first (quick wins). Compared
// with paying every debt only its own payment, with no extra money and
// nothing passed on from a paid off debt.
export function payoffPlan(debts, extraPerMonth = 0, strategy = 'avalanche', startMonth = null) {
  const list = (debts || []).filter(d => d.balance > 0);
  const extra = Math.max(0, extraPerMonth || 0);
  const budget = list.reduce((s, d) => s + Math.max(0, d.payment || 0), 0) + extra;
  const monthOfIndex = (n) => (startMonth && n ? addMonthsToMonth(startMonth, n - 1) : null);

  const alone = list.map(d => payoffSchedule(d.balance, d.rate, d.payment, startMonth || '2000-01'));
  const baseNever = alone.some(s => s.never);
  const baseline = {
    months: baseNever ? null : Math.max(0, ...alone.map(s => s.months)),
    totalInterest: baseNever ? null : alone.reduce((s, x) => s + x.totalInterest, 0),
    never: baseNever
  };

  const plan = simulate(list, budget, strategy === 'snowball' ? 'snowball' : 'avalanche');
  return {
    strategy: strategy === 'snowball' ? 'snowball' : 'avalanche',
    extra,
    budget,
    order: plan.order.map(d => ({ ...d, payoffMonth: monthOfIndex(d.months) })),
    months: plan.months,
    payoffMonth: monthOfIndex(plan.months),
    totalInterest: plan.totalInterest,
    never: plan.never,
    baseline: { ...baseline, payoffMonth: monthOfIndex(baseline.months) },
    monthsSaved: plan.never || baseline.never ? null : Math.max(0, baseline.months - plan.months),
    interestSaved: plan.never || baseline.never ? null : Math.max(0, baseline.totalInterest - plan.totalInterest)
  };
}

// The debts a plan works with: open loans I pay off, with what is left today.
export function planDebts(data, today) {
  return live(data.debts).filter(d => d.kind !== 'owed' && !d.archived).map(d => {
    const s = debtState(data, d, today);
    return { id: d.id, name: d.name, balance: s.remaining, rate: Number(d.rate) || 0, payment: d.payment || 0 };
  }).filter(d => d.balance > 0);
}
