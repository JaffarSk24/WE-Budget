// Overview: free money, what needs attention today, envelopes, forecast.

import Chart from 'chart.js/auto';
import { store } from '../store.js';
import { t, tn } from '../i18n.js';
import { h, clear, icon, money, moneyEl, refreshIcons, lang, emptyState, badge } from '../ui.js';
import { accountSummaries, entriesOn, forecast, grandTotals, monthPlanFact, overdueEntries, upcomingEntries } from '../ledger.js';
import { addDays, formatDate, formatDay, formatDayLong, lastDayOfMonth, monthOf, todayKey } from '../dates.js';
import { generationHorizon } from '../schedule.js';
import { entryListItem } from '../actions.js';
import { openAllocationModal, openQuickExpense } from '../modals.js';
import { live } from '../model.js';

let chart = null;

function kpi(label, value, sub, cls = '') {
  return h('div', { class: `stat-card kpi ${cls}` },
    h('div', { class: 'stat-header' }, h('span', {}, label)),
    h('div', { class: 'stat-value' }, value),
    sub ? h('div', { class: 'stat-desc' }, sub) : null);
}

// One line of this month's plan: how much of the planned income came in, or
// of the planned expenses went out, and what is still to come.
function planRow(kind, row) {
  const percent = row.plan > 0 ? Math.round((row.fact / row.plan) * 100) : (row.fact > 0 ? 100 : 0);
  const over = row.fact - row.plan;
  const isOver = kind === 'expense' && over > 0;
  let note;
  if (isOver) note = h('span', { class: 'plan-note' }, icon('alert-triangle'), t('ov-plan-over', { amount: money(over) }));
  else if (row.open > 0) note = h('span', { class: 'plan-note' }, t(kind === 'income' ? 'ov-plan-income-open' : 'ov-plan-expense-open', { amount: money(row.open) }));
  else if (over > 0) note = h('span', { class: 'plan-note' }, t('ov-plan-income-more', { amount: money(over) }));
  else note = h('span', { class: 'plan-note' }, t('ov-plan-all-done'));
  return h('div', { class: `plan-row plan-${kind} ${isOver ? 'is-over' : ''}` },
    h('div', { class: 'plan-row-head' },
      h('span', { class: 'plan-row-label' }, t(kind === 'income' ? 'ov-plan-income' : 'ov-plan-expense')),
      h('span', { class: 'money' }, t('ov-plan-of', { fact: money(row.fact), plan: money(row.plan) }))),
    h('div', { class: 'goal-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(100, percent)) },
      h('div', { class: 'goal-bar-fill', style: `width: ${Math.min(100, percent)}%` })),
    h('div', { class: 'plan-row-foot' }, note, h('span', {}, `${percent}%`)),
    kind === 'expense' && row.quick > 0 ? h('div', { class: 'plan-row-foot' }, t('ov-plan-quick', { amount: money(row.quick) })) : null);
}

function planCard(month) {
  const p = monthPlanFact(store.data, month);
  const empty = !p.income.plan && !p.income.fact && !p.expense.plan && !p.expense.fact;
  return h('div', { class: 'card' },
    h('div', { class: 'card-title-row' }, icon('calendar-days'), h('h3', {}, t('ov-plan-title'))),
    empty ? h('p', { class: 'muted small' }, t('ov-plan-none'))
      : h('div', { class: 'plan-rows' }, planRow('income', p.income), planRow('expense', p.expense)));
}

function listCard(title, iconName, entries, emptyText, cls = '') {
  return h('div', { class: `card list-card ${cls}` },
    h('div', { class: 'card-title-row' }, icon(iconName), h('h3', {}, title), entries.length ? h('span', { class: 'count-pill' }, entries.length) : null),
    entries.length ? h('div', { class: 'list' }, entries.map(e => entryListItem(e))) : h('p', { class: 'muted small' }, emptyText));
}

function envelopeTable() {
  const accounts = live(store.data.accounts).filter(a => !a.archived);
  if (!accounts.length) return emptyState(t('no-accounts-yet'), 'wallet');
  const s = accountSummaries(store.data);
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
  const tops = accounts.filter(a => !a.parentId).sort(byOrder);
  const rows = [];
  const line = (cls, label, balance, reserved, free) => h('tr', { class: cls },
    h('td', {}, label),
    h('td', { class: 'num money' }, money(balance)),
    h('td', { class: 'num money reserved' }, reserved ? money(reserved) : ''),
    h('td', { class: `num money ${free < 0 ? 'negative' : ''}` }, money(free)));
  tops.forEach(top => {
    const ts = s.get(top.id);
    const children = accounts.filter(a => a.parentId === top.id).sort(byOrder);
    rows.push(line('env-top', top.name, ts.totalBalance, ts.totalReserved + ts.totalFrozen, ts.totalFree));
    if (!children.length) return;
    // The account itself comes first inside its group, envelopes after it.
    if (ts.ownBalance || ts.ownReserved) {
      rows.push(line('env-child env-own', [top.name, ' ', badge(t('account-main'), 'badge-main')], ts.ownBalance, ts.ownReserved + ts.ownFrozen, ts.ownFree));
    }
    children.forEach(c => {
      const cs = s.get(c.id);
      if (!cs.ownBalance && !cs.ownReserved) return;
      rows.push(line('env-child', c.name, cs.ownBalance, cs.ownReserved + cs.ownFrozen, cs.ownFree));
    });
  });
  return h('table', { class: 'env-table' },
    h('thead', {}, h('tr', {},
      h('th', {}, t('col-account')), h('th', { class: 'num' }, t('col-balance')),
      h('th', { class: 'num' }, t('col-reserved')), h('th', { class: 'num' }, t('col-free')))),
    h('tbody', {}, rows));
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawForecast(canvas, f) {
  if (chart) { chart.destroy(); chart = null; }
  const line = cssVar('--accent-indigo');
  const danger = cssVar('--danger');
  const grid = cssVar('--border-color');
  const text = cssVar('--text-secondary');
  const l = lang();
  chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: f.points.map(p => p.day),
      datasets: [{
        data: f.points.map(p => p.value / 100),
        borderColor: line,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderWidth: 2,
        pointHoverBackgroundColor: line,
        tension: 0,
        stepped: 'before',
        segment: { borderColor: ctx => (ctx.p1.parsed.y < 0 ? danger : line) },
        fill: { target: 'origin', above: 'transparent', below: danger + '22' }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: items => formatDayLong(items[0].label, l),
            label: item => money(Math.round(item.parsed.y * 100))
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: text, maxRotation: 0, autoSkip: true, maxTicksLimit: 8,
            callback: (value, index) => formatDay(f.points[index].day, l)
          }
        },
        y: {
          grid: { color: ctx => (ctx.tick.value === 0 ? text : grid), lineWidth: ctx => (ctx.tick.value === 0 ? 1.5 : 1) },
          border: { display: false },
          ticks: { color: text, callback: v => money(Math.round(v * 100), { decimals: false }) }
        }
      }
    }
  });
}

export function renderOverview(root) {
  const today = todayKey();
  clear(root);

  const totals = grandTotals(store.data, today);
  const month = monthOf(today);

  const horizon = generationHorizon(today, store.settings.forecastMonths || 3);
  const f = forecast(store.data, today, horizon);
  // Free money left when this month's plan is done.
  const monthEnd = f.points.find(p => p.day === lastDayOfMonth(month));
  const monthEndFree = monthEnd ? monthEnd.value : f.start;
  const overdue = overdueEntries(store.data, today);
  const todays = entriesOn(store.data, today, { openOnly: true });
  const week = upcomingEntries(store.data, addDays(today, 1), addDays(today, 7));

  root.appendChild(h('div', { class: 'view-header' },
    h('div', {},
      h('h1', { class: 'view-title' }, t('nav-overview')),
      h('p', { class: 'view-subtitle' }, formatDayLong(today, lang()))),
    h('div', { class: 'header-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openAllocationModal() }, icon('split'), t('alloc-open')),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openQuickExpense() }, icon('plus'), t('quick-add')))));

  root.appendChild(h('div', { class: 'dashboard-grid kpi-grid' },
    kpi(t('kpi-free'), moneyEl(totals.free, { colored: true }), t('kpi-free-desc'), totals.free < 0 ? 'alert' : 'primary'),
    kpi(t('kpi-reserved'), moneyEl(totals.reserved + totals.frozen),
      totals.frozen ? t('kpi-reserved-goals', { reserved: money(totals.reserved), frozen: money(totals.frozen) }) : t('kpi-reserved-desc'), 'reserved'),
    kpi(t('kpi-balance'), moneyEl(totals.balance), t('kpi-balance-desc')),
    kpi(t('kpi-month-end'), moneyEl(monthEndFree, { colored: true }), t('kpi-month-end-desc'), monthEndFree < 0 ? 'alert' : '')));

  if (f.firstNegative) {
    const dip = f.firstNegative;
    root.appendChild(h('div', { class: 'banner banner-danger' }, icon('alert-triangle'),
      h('span', {}, t('forecast-negative', {
        date: formatDate(dip.day, lang()),
        name: dip.entry.title || t('untitled'),
        payment: money(dip.entry.amount),
        // Before this payment the total was still at zero or above, so what
        // is missing is the part of the payment the money does not cover.
        shortage: money(-dip.value)
      }))));
  }

  root.appendChild(h('div', { class: 'overview-lists' },
    listCard(tn('overdue-title', overdue.length), 'alert-triangle', overdue, t('overdue-none'), overdue.length ? 'attention' : ''),
    listCard(t('today-title'), 'calendar-check', todays, t('today-none')),
    listCard(t('week-title'), 'calendar-range', week, t('week-none'))));

  const canvas = h('canvas', { 'aria-label': t('forecast-title'), role: 'img' });
  root.appendChild(h('div', { class: 'overview-bottom' },
    h('div', { class: 'overview-stack' },
      h('div', { class: 'card chart-card' },
        h('div', { class: 'card-title-row' }, icon('trending-up'), h('h3', {}, t('forecast-title')),
          h('span', { class: 'muted small push-right' }, t('forecast-sub', { amount: money(f.end), date: formatDay(horizon, lang()) }))),
        h('div', { class: 'chart-container' }, canvas)),
      planCard(month)),
    h('div', { class: 'card' },
      h('div', { class: 'card-title-row' }, icon('wallet'), h('h3', {}, t('envelopes-title'))),
      envelopeTable())));

  refreshIcons();
  if (f.points.length > 1) requestAnimationFrame(() => drawForecast(canvas, f));
}
