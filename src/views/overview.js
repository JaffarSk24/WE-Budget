// Overview: free money, what needs attention today, envelopes, forecast.

import Chart from 'chart.js/auto';
import { store } from '../store.js';
import { t, tn } from '../i18n.js';
import { h, clear, icon, money, moneyEl, refreshIcons, lang, emptyState } from '../ui.js';
import { accountSummaries, entriesOn, forecast, grandTotals, monthSummary, overdueEntries, upcomingEntries } from '../ledger.js';
import { addDays, formatDay, formatDayLong, monthOf, todayKey } from '../dates.js';
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
  tops.forEach(top => {
    const ts = s.get(top.id);
    rows.push(h('tr', { class: 'env-top' },
      h('td', {}, top.name),
      h('td', { class: 'num money' }, money(ts.totalBalance)),
      h('td', { class: 'num money reserved' }, ts.totalReserved ? money(ts.totalReserved) : ''),
      h('td', { class: `num money ${ts.totalFree < 0 ? 'negative' : ''}` }, money(ts.totalFree))));
    accounts.filter(a => a.parentId === top.id).sort(byOrder).forEach(c => {
      const cs = s.get(c.id);
      if (!cs.ownBalance && !cs.ownReserved) return;
      rows.push(h('tr', { class: 'env-child' },
        h('td', {}, c.name),
        h('td', { class: 'num money' }, money(cs.ownBalance)),
        h('td', { class: 'num money reserved' }, cs.ownReserved ? money(cs.ownReserved) : ''),
        h('td', { class: `num money ${cs.ownFree < 0 ? 'negative' : ''}` }, money(cs.ownFree))));
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
  const sum = monthSummary(store.data, month);
  const horizon = generationHorizon(today, store.settings.forecastMonths || 3);
  const f = forecast(store.data, today, horizon);
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
    kpi(t('kpi-reserved'), moneyEl(totals.reserved), t('kpi-reserved-desc'), 'reserved'),
    kpi(t('kpi-balance'), moneyEl(totals.balance), t('kpi-balance-desc')),
    kpi(t('kpi-month-end'), moneyEl(sum.closing, { colored: true }), t('kpi-month-end-desc'), sum.closing < 0 ? 'alert' : '')));

  if (f.firstNegative) {
    root.appendChild(h('div', { class: 'banner banner-danger' }, icon('alert-triangle'),
      h('span', {}, t('forecast-negative', { date: formatDayLong(f.firstNegative, lang()), amount: money(f.minimum.value) }))));
  }

  root.appendChild(h('div', { class: 'overview-lists' },
    listCard(tn('overdue-title', overdue.length), 'alert-triangle', overdue, t('overdue-none'), overdue.length ? 'attention' : ''),
    listCard(t('today-title'), 'calendar-check', todays, t('today-none')),
    listCard(t('week-title'), 'calendar-range', week, t('week-none'))));

  const canvas = h('canvas', { 'aria-label': t('forecast-title'), role: 'img' });
  root.appendChild(h('div', { class: 'overview-bottom' },
    h('div', { class: 'card chart-card' },
      h('div', { class: 'card-title-row' }, icon('trending-up'), h('h3', {}, t('forecast-title')),
        h('span', { class: 'muted small push-right' }, t('forecast-sub', { amount: money(f.end), date: formatDay(horizon, lang()) }))),
      h('div', { class: 'chart-container' }, canvas)),
    h('div', { class: 'card' },
      h('div', { class: 'card-title-row' }, icon('wallet'), h('h3', {}, t('envelopes-title'))),
      envelopeTable())));

  refreshIcons();
  if (f.points.length > 1) requestAnimationFrame(() => drawForecast(canvas, f));
}
