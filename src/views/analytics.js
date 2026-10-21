// Analytics: where the money went and where it came from, month by month
// and by category, against the plan, with averages and this month's
// limits. Everything counts money that actually moved; pass-through money
// and transfers between own accounts stay out, adjustments are shown apart.

import Chart from 'chart.js/auto';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { h, clear, icon, money, refreshIcons, lang, emptyState, categoryName } from '../ui.js';
import { analyticsByMonth, categoryAverages, categoryBreakdown, categorySpentInMonth, effectiveLimit, firstFlowMonth, limitCarry } from '../ledger.js';
import { addMonthsToMonth, firstDayOfMonth, formatMonth, formatMonthInText, formatMonthShort, lastDayOfMonth, monthOf, todayKey } from '../dates.js';
import { live } from '../model.js';
import { tagsAnalyticsCard } from './tags.js';
import { moneyFlowCard } from './money-flow.js';
import { netWorthCard } from './networth.js';

const PERIODS = ['3', '6', '12', 'all'];
const TOP_CATEGORIES = 8;
let period = '6';
const charts = [];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function destroyCharts() {
  while (charts.length) charts.pop().destroy();
}

function monthLabel(month) {
  return formatMonth(month, lang());
}

// A month inside a sentence keeps the language's own case.
function monthInText(month) {
  return formatMonthInText(month, lang());
}

// "marzo de 2026 a octubre de 2026" starts a line, so its first letter is
// a capital one, whichever placeholder the language puts first.
function rangeText(from, to) {
  const s = t('an-range', { from: monthInText(from), to: monthInText(to) });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortMonth(month) {
  return formatMonthShort(month, lang());
}

function catLabel(id) {
  return id ? categoryName(id) : t('no-category');
}

function tile(label, value, sub, cls = '') {
  return h('div', { class: `stat-card kpi ${cls}` },
    h('div', { class: 'stat-header' }, h('span', {}, label)),
    h('div', { class: 'stat-value' }, value),
    sub ? h('div', { class: 'stat-desc' }, sub) : null);
}

function axisMoney(v) {
  return money(Math.round(v * 100), { decimals: false });
}

function drawMonths(canvas, rows) {
  const text = cssVar('--text-secondary');
  const grid = cssVar('--border-color');
  const income = cssVar('--series-1');
  const expense = cssVar('--series-2');
  const surface = cssVar('--bg-secondary');
  charts.push(new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(r => shortMonth(r.month)),
      datasets: [
        { label: t('an-income'), data: rows.map(r => r.income / 100), backgroundColor: income, borderColor: surface, borderWidth: { top: 0, left: 1, right: 1, bottom: 0 }, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', categoryPercentage: 0.7, barPercentage: 0.9 },
        { label: t('an-expense'), data: rows.map(r => r.expense / 100), backgroundColor: expense, borderColor: surface, borderWidth: { top: 0, left: 1, right: 1, bottom: 0 }, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', categoryPercentage: 0.7, barPercentage: 0.9 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { color: text, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } },
        tooltip: {
          callbacks: {
            title: items => monthLabel(rows[items[0].dataIndex].month),
            label: item => `${item.dataset.label}: ${money(Math.round(item.parsed.y * 100))}`,
            footer: items => {
              const r = rows[items[0].dataIndex];
              return `${t('an-result')}: ${money(r.income - r.expense, { signed: true })}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: text, maxRotation: 0, autoSkip: true } },
        y: {
          beginAtZero: true,
          grid: { color: grid },
          border: { display: false },
          ticks: { color: text, callback: axisMoney, maxTicksLimit: 6 }
        }
      }
    }
  }));
}

function drawCategories(canvas, items) {
  const text = cssVar('--text-secondary');
  const grid = cssVar('--border-color');
  const bar = cssVar('--series-1');
  charts.push(new Chart(canvas, {
    type: 'bar',
    data: {
      labels: items.map(i => i.label),
      datasets: [{ data: items.map(i => i.amount / 100), backgroundColor: bar, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'left', barPercentage: 0.8, categoryPercentage: 0.9 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { label: item => money(Math.round(item.parsed.x * 100)) } }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, callback: axisMoney, maxTicksLimit: 5 } },
        y: { grid: { display: false }, ticks: { color: text, autoSkip: false } }
      }
    }
  }));
}

function periodControl(root) {
  return h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('an-period') }, PERIODS.map(p => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(p === period),
    class: `segmented-item ${p === period ? 'active' : ''}`,
    onclick: () => { period = p; renderAnalytics(root); }
  }, p === 'all' ? t('an-all') : t('months-n', { n: Number(p) }))));
}

function categoryTable(items, month, total) {
  const avg3 = categoryAverages(store.data, month, 3);
  const avg6 = categoryAverages(store.data, month, 6);
  const avg12 = categoryAverages(store.data, month, 12);
  return h('div', { class: 'table-scroll' }, h('table', { class: 'an-table' },
    h('thead', {}, h('tr', {},
      h('th', {}, t('field-category')),
      h('th', { class: 'num' }, t('an-period-total')),
      h('th', { class: 'num' }, t('an-share')),
      h('th', { class: 'num' }, t('an-avg-n', { n: 3 })),
      h('th', { class: 'num' }, t('an-avg-n', { n: 6 })),
      h('th', { class: 'num' }, t('an-avg-n', { n: 12 })))),
    h('tbody', {}, items.map(r => h('tr', {},
      h('td', {}, catLabel(r.categoryId)),
      h('td', { class: 'num money' }, money(r.amount)),
      h('td', { class: 'num muted' }, total ? `${Math.round((r.amount / total) * 100)}%` : ''),
      h('td', { class: 'num money' }, avg3.has(r.categoryId) ? money(avg3.get(r.categoryId)) : ''),
      h('td', { class: 'num money' }, avg6.has(r.categoryId) ? money(avg6.get(r.categoryId)) : ''),
      h('td', { class: 'num money' }, avg12.has(r.categoryId) ? money(avg12.get(r.categoryId)) : ''))))));
}

function planTable(rows) {
  return h('div', { class: 'table-scroll' }, h('table', { class: 'an-table' },
    h('thead', {}, h('tr', {},
      h('th', {}, t('an-month')),
      h('th', { class: 'num' }, t('an-plan')),
      h('th', { class: 'num' }, t('an-fact')),
      h('th', { class: 'num' }, t('an-diff')),
      h('th', { class: 'num' }, t('an-adjustments')))),
    h('tbody', {}, rows.slice().reverse().map(r => {
      const diff = r.expense - r.plan;
      return h('tr', {},
        h('td', {}, monthLabel(r.month)),
        h('td', { class: 'num money' }, money(r.plan)),
        h('td', { class: 'num money' }, money(r.expense)),
        h('td', { class: `num money ${diff > 0 ? 'an-over' : ''}` }, diff ? money(diff, { signed: true }) : ''),
        h('td', { class: 'num money muted' }, r.adjustments ? money(r.adjustments, { signed: true }) : ''));
    }))));
}

function limitsCard(month) {
  const cats = live(store.data.categories).filter(c => c.type === 'expense' && c.monthlyLimit && !c.archived);
  if (!cats.length) return null;
  return h('div', { class: 'card' },
    h('div', { class: 'card-title-row' }, icon('gauge'), h('h3', {}, t('an-limits', { month: monthInText(month) }))),
    h('div', { class: 'an-limits' }, cats.map(c => {
      const spent = categorySpentInMonth(store.data, c.id, month);
      const limit = effectiveLimit(store.data, c.id, month);
      const carried = limitCarry(store.data, c, month);
      const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : (spent > 0 ? 100 : 0);
      const over = spent > limit;
      return h('div', { class: `an-limit ${over ? 'is-over' : ''}` },
        h('div', { class: 'an-limit-head' },
          h('span', {}, c.name),
          h('span', { class: 'money' }, `${money(spent)} / ${money(limit)}`)),
        h('div', { class: 'goal-bar' }, h('div', { class: 'goal-bar-fill', style: `width: ${pct}%` })),
        over ? h('div', { class: 'an-limit-note' }, icon('alert-triangle'), t('an-limit-over', { amount: money(spent - limit) }))
          : h('div', { class: 'an-limit-note muted' }, t('an-limit-left', { amount: money(limit - spent) })),
        carried ? h('div', { class: 'an-limit-note muted' }, t(carried > 0 ? 'rollover-carried-in' : 'rollover-carried-off', { amount: money(Math.abs(carried)) })) : null);
    })));
}

export function renderAnalytics(root) {
  destroyCharts();
  clear(root);
  const today = todayKey();
  const month = monthOf(today);
  const first = firstFlowMonth(store.data);

  root.appendChild(h('div', { class: 'view-header' },
    h('div', {}, h('h1', { class: 'view-title' }, t('nav-analytics')), h('p', { class: 'view-subtitle' }, t('analytics-subtitle'))),
    h('div', { class: 'header-actions' }, periodControl(root))));

  if (!first) {
    root.appendChild(h('div', { class: 'card' }, emptyState(t('an-empty'), 'chart-column')));
    // A trip planned ahead has a budget before anything is spent.
    const tags = tagsAnalyticsCard(today);
    if (tags) root.appendChild(tags);
    // Property and debts make a net worth even before any money moved.
    const worth = netWorthCard(today, period === 'all' ? 12 : Number(period));
    root.appendChild(worth.card);
    refreshIcons();
    const worthChart = worth.draw();
    if (worthChart) charts.push(worthChart);
    return;
  }

  let fromMonth = period === 'all' ? first : addMonthsToMonth(month, -(Number(period) - 1));
  if (fromMonth < first) fromMonth = first;
  const rows = analyticsByMonth(store.data, fromMonth, month);
  const from = firstDayOfMonth(fromMonth);
  const to = lastDayOfMonth(month);
  const income = rows.reduce((s, r) => s + r.income, 0);
  const expense = rows.reduce((s, r) => s + r.expense, 0);
  const fullMonths = rows.filter(r => r.month < month);
  const avgExpense = fullMonths.length ? Math.round(fullMonths.reduce((s, r) => s + r.expense, 0) / fullMonths.length) : null;

  root.appendChild(h('div', { class: 'dashboard-grid kpi-grid' },
    tile(t('an-income'), money(income), rangeText(fromMonth, month)),
    tile(t('an-expense'), money(expense), rangeText(fromMonth, month)),
    tile(t('an-result'), money(income - expense, { signed: true }), t('an-result-desc'), income - expense < 0 ? 'is-negative' : ''),
    tile(t('an-avg-expense'), avgExpense === null ? '' : money(avgExpense), t('an-avg-expense-desc', { n: fullMonths.length }))));

  const monthsCanvas = h('canvas', { 'aria-label': t('an-months-title'), role: 'img' });
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-title-row' }, icon('chart-column'), h('h3', {}, t('an-months-title'))),
    h('div', { class: 'an-chart' }, monthsCanvas)));

  root.appendChild(moneyFlowCard(today, from, to));

  const expenses = categoryBreakdown(store.data, from, to, 'expense');
  const top = expenses.slice(0, TOP_CATEGORIES);
  const rest = expenses.slice(TOP_CATEGORIES).reduce((s, r) => s + r.amount, 0);
  const barItems = top.map(r => ({ label: catLabel(r.categoryId), amount: r.amount }));
  if (rest) barItems.push({ label: t('an-other'), amount: rest });
  const catCanvas = h('canvas', { 'aria-label': t('an-categories-title'), role: 'img' });
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-title-row' }, icon('tags'), h('h3', {}, t('an-categories-title'))),
    expenses.length
      ? [h('div', { class: 'an-chart an-chart-bars', style: `height: ${Math.max(160, barItems.length * 34 + 40)}px` }, catCanvas), categoryTable(expenses, month, expense)]
      : h('p', { class: 'muted small' }, t('an-none'))));

  const incomes = categoryBreakdown(store.data, from, to, 'income');
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-title-row' }, icon('trending-up'), h('h3', {}, t('an-income-title'))),
    incomes.length ? h('div', { class: 'table-scroll' }, h('table', { class: 'an-table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('an-source')), h('th', { class: 'num' }, t('an-period-total')), h('th', { class: 'num' }, t('an-share')))),
      h('tbody', {}, incomes.map(r => h('tr', {},
        h('td', {}, catLabel(r.categoryId)),
        h('td', { class: 'num money' }, money(r.amount)),
        h('td', { class: 'num muted' }, income ? `${Math.round((r.amount / income) * 100)}%` : '')))))) : h('p', { class: 'muted small' }, t('an-none'))));

  // 'All' reaches back to the first month with money, never before the
  // tracking start (balances are not known before it).
  const worth = netWorthCard(today, rows.length);
  root.appendChild(worth.card);

  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-title-row' }, icon('scale'), h('h3', {}, t('an-plan-title'))),
    h('p', { class: 'field-hint' }, t('an-plan-hint')),
    planTable(rows)));

  const limits = limitsCard(month);
  if (limits) root.appendChild(limits);
  const tags = tagsAnalyticsCard(today);
  if (tags) root.appendChild(tags);
  refreshIcons();

  // Charts need their canvas in the page to measure it.
  drawMonths(monthsCanvas, rows);
  if (expenses.length) drawCategories(catCanvas, barItems);
  const worthChart = worth.draw();
  if (worthChart) charts.push(worthChart);
}
