// Where the money came from and where it went in a period, as the nodes and
// links of a Sankey diagram: income sources flow into one Income node, which
// flows out to expense categories and to what was saved. When more went out
// than came in, the difference comes from savings on the income side, so
// both sides always add up to the same total. Pure, amounts in cents.

import { live } from './model.js';
import { budgetFlow, categoryBreakdown, frozenAccounts } from './ledger.js';

export const SANKEY_MAX_CATEGORIES = 8;

// The largest `max` rows as they are, the rest summed into one 'other' row
// (only when that leaves out at least two, a single row is shown by name).
function topWithOther(rows, max, otherKey) {
  if (rows.length <= max) return rows.map(r => ({ key: `cat:${r.categoryId ?? 'none'}`, categoryId: r.categoryId, amount: r.amount }));
  const top = rows.slice(0, max - 1);
  const rest = rows.slice(max - 1);
  return top.map(r => ({ key: `cat:${r.categoryId ?? 'none'}`, categoryId: r.categoryId, amount: r.amount }))
    .concat({ key: otherKey, categoryId: null, other: true, count: rest.length, amount: rest.reduce((s, r) => s + r.amount, 0) });
}

// Money moved into goals' accounts in the period, as the budget counts it
// (a payment out of the budget's free money). It is part of what was saved.
export function goalContributions(data, from, to) {
  const frozen = frozenAccounts(data);
  return live(data.entries).reduce((sum, e) => {
    if (e.type !== 'transfer' || e.status !== 'done' || e.date < from || e.date > to) return sum;
    const flow = budgetFlow(e, frozen);
    if (!flow) return sum;
    return sum + (flow.type === 'expense' ? flow.amount : -flow.amount);
  }, 0);
}

// Income and expenses come from categoryBreakdown, the same figures as the
// rest of Analytics (done, without transit, adjustments and transfers).
export function sankeyData(data, from, to, { maxCategories = SANKEY_MAX_CATEGORIES } = {}) {
  const max = Math.max(2, Math.floor(maxCategories) || SANKEY_MAX_CATEGORIES);
  const incomeRows = categoryBreakdown(data, from, to, 'income').filter(r => r.amount > 0);
  const expenseRows = categoryBreakdown(data, from, to, 'expense').filter(r => r.amount > 0);
  const income = incomeRows.reduce((s, r) => s + r.amount, 0);
  const expense = expenseRows.reduce((s, r) => s + r.amount, 0);
  const total = Math.max(income, expense);

  const sources = topWithOther(incomeRows, max, 'other-income');
  const targets = topWithOther(expenseRows, max, 'other-expense');
  const saved = income > expense ? income - expense : 0;
  const fromSavings = expense > income ? expense - income : 0;
  if (fromSavings) sources.push({ key: 'from-savings', categoryId: null, amount: fromSavings });
  if (saved) targets.push({ key: 'saved', categoryId: null, amount: saved });

  const links = sources.map(s => ({ source: s.key, target: 'income', amount: s.amount }))
    .concat(targets.map(x => ({ source: 'income', target: x.key, amount: x.amount })));

  return {
    from, to, income, expense, saved, fromSavings, total,
    toGoals: Math.max(0, goalContributions(data, from, to)),
    sources, targets, links,
    empty: total === 0
  };
}
