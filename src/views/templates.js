// Recurring payments and incomes that build the plan months ahead.

import { store } from '../store.js';
import { t } from '../i18n.js';
import { h, clear, icon, money, refreshIcons, lang, emptyState, badge, accountLabel, categoryName, selectEl } from '../ui.js';
import { dayInMonth, formatDate, formatDay, todayKey } from '../dates.js';
import { openTemplateModal, segmented } from '../modals.js';
import { canSaveAhead, recurringOverview, saveAheadGoal } from '../ledger.js';
import { openSaveAheadModal, saveAheadSummary, stopSaveAhead } from './save-ahead.js';

// 'all' lists every template, 'overview' what the recurring expenses cost.
let mode = 'all';
let overviewCategory = '';

const WEEKDAY_KEYS = ['wd-mon', 'wd-tue', 'wd-wed', 'wd-thu', 'wd-fri', 'wd-sat', 'wd-sun'];

export function describeSchedule(s) {
  const dayText = s.day >= 31 ? t('sched-last-day') : t('sched-day', { day: s.day });
  switch (s.freq) {
    case 'monthly': return t('sched-monthly', { day: dayText });
    case 'everyNMonths': return t('sched-every-n', { n: s.interval, day: dayText }) + (s.fillGaps ? ', ' + t('sched-fill-gaps') : '');
    case 'yearly': return t('sched-yearly', { date: formatDay(dayInMonth(`2001-${(s.startDate || '2001-01-01').slice(5, 7)}`, s.day), lang()) });
    case 'weekly': return t('sched-weekly', { days: (s.weekdays || []).map(i => t(WEEKDAY_KEYS[i])).join(', ') });
    case 'once': return t('sched-once', { date: s.startDate ? formatDay(s.startDate, lang()) + '.' + s.startDate.slice(0, 4) : '' });
    default: return '';
  }
}

// Saving ahead on a row: how far it is and a switch to stop it, or a
// button to start it for a payment that does not come every month.
function saveAheadParts(tpl, today) {
  const goal = saveAheadGoal(store.data, tpl.id);
  if (goal) {
    return {
      line: h('div', { class: 'row-meta tpl-ahead' }, icon('piggy-bank'), h('span', {}, saveAheadSummary(goal, today))),
      button: h('button', { type: 'button', class: 'icon-btn is-on', title: t('save-ahead-stop'), 'aria-label': t('save-ahead-stop'), onclick: () => stopSaveAhead(goal) }, icon('piggy-bank'))
    };
  }
  if (!tpl.active || !canSaveAhead(tpl)) return { line: null, button: null };
  return {
    line: null,
    button: h('button', { type: 'button', class: 'icon-btn', title: t('save-ahead'), 'aria-label': t('save-ahead'), onclick: () => openSaveAheadModal(tpl) }, icon('piggy-bank'))
  };
}

function templateRow(tpl, today) {
  const sign = tpl.type === 'income' ? 'positive' : tpl.type === 'transfer' ? 'neutral' : '';
  const ahead = saveAheadParts(tpl, today);
  return h('tr', { class: `tpl-row ${tpl.active ? '' : 'is-inactive'}`, ondblclick: () => openTemplateModal(tpl) },
    h('td', {},
      h('div', { class: 'row-title' }, tpl.title,
        tpl.isTransit ? badge(t('badge-transit'), 'badge-muted') : null,
        tpl.goalId ? badge(t('template-goal'), 'badge-muted') : null,
        tpl.active ? null : badge(t('template-paused'), 'badge-muted')),
      h('div', { class: 'row-meta' }, [t(`type-${tpl.type}`), tpl.categoryId ? categoryName(tpl.categoryId) : null].filter(Boolean).join(' · ')),
      ahead.line),
    h('td', {}, describeSchedule(tpl.schedule),
      tpl.schedule.endDate ? h('div', { class: 'row-meta' }, t('sched-until', { date: formatDay(tpl.schedule.endDate, lang()) + '.' + tpl.schedule.endDate.slice(0, 4) })) : null),
    h('td', {}, tpl.type === 'transfer' ? `${accountLabel(tpl.accountId)} → ${accountLabel(tpl.toAccountId)}` : accountLabel(tpl.accountId)),
    h('td', { class: `num money ${sign}` }, (tpl.amountIsEstimate ? '≈ ' : '') + money(tpl.amount)),
    h('td', { class: 'col-actions' },
      h('div', { class: 'tpl-actions' },
        ahead.button,
        h('button', { type: 'button', class: 'icon-btn', title: t('edit'), 'aria-label': t('edit'), onclick: () => openTemplateModal(tpl) }, icon('pencil')))));
}

function percentText(p) {
  return `${p > 0 ? '+' : ''}${p}%`;
}

// The price column: the latest change of price, the last charge when it
// never changed, or nothing charged yet.
function priceCell(row) {
  const tpl = row.template;
  if (row.change) {
    const up = row.change.to > row.change.from;
    return h('div', { class: 'ovr-price' },
      h('div', { class: up ? 'ovr-price-up' : 'ovr-price-down' },
        t('ovr-price-change', { from: money(row.change.from), to: money(row.change.to) }),
        row.change.percent !== null ? h('span', { class: 'ovr-percent' }, ' ' + percentText(row.change.percent)) : null),
      h('div', { class: 'row-meta' }, t('ovr-price-since', { date: formatDate(row.change.date, lang()) })));
  }
  if (tpl.amountIsEstimate) return h('div', { class: 'row-meta' }, t('ovr-price-varies'));
  if (row.last) return h('div', { class: 'row-meta' }, t('ovr-price-same'));
  return h('div', { class: 'row-meta' }, t('ovr-price-none'));
}

function overviewRow(row) {
  const tpl = row.template;
  return h('tr', { class: 'ovr-row', ondblclick: () => openTemplateModal(tpl) },
    h('td', { class: 'ovr-item' },
      h('div', { class: 'row-title' }, tpl.title),
      h('div', { class: 'row-meta' }, [describeSchedule(tpl.schedule), tpl.categoryId ? categoryName(tpl.categoryId) : null].filter(Boolean).join(' · '))),
    h('td', { class: 'num money ovr-monthly', 'data-label': t('ovr-col-monthly') }, (tpl.amountIsEstimate ? '≈ ' : '') + money(row.monthly)),
    h('td', { class: 'num money ovr-yearly', 'data-label': t('ovr-col-yearly') }, (tpl.amountIsEstimate ? '≈ ' : '') + money(row.yearly)),
    h('td', { class: 'ovr-next', 'data-label': t('ovr-col-next') }, row.next ? formatDate(row.next, lang()) : t('ovr-no-next')),
    h('td', { class: 'ovr-price-cell', 'data-label': t('ovr-col-price') }, priceCell(row)));
}

function renderOverviewMode(root, today) {
  const all = recurringOverview(store.data, today);
  const used = new Set(all.rows.map(r => r.template.categoryId).filter(Boolean));
  const categories = store.list('categories');
  // Only categories with recurring expenses (in them or in a subcategory).
  const cats = categories
    .filter(c => c.type === 'expense' && (used.has(c.id) || categories.some(x => x.parentId === c.id && used.has(x.id))))
    .sort((a, b) => a.name.localeCompare(b.name, lang()));
  // A category picked earlier may have no recurring expenses left.
  if (!cats.some(c => c.id === overviewCategory)) overviewCategory = '';
  const view = overviewCategory ? recurringOverview(store.data, today, { categoryId: overviewCategory }) : all;
  const filter = selectEl([{ value: '', label: t('ovr-all-categories') }, ...cats.map(c => ({ value: c.id, label: c.name }))], overviewCategory, { 'aria-label': t('field-category') });
  filter.addEventListener('change', () => { overviewCategory = filter.value; renderTemplates(root); });

  root.appendChild(h('div', { class: 'summary-strip' },
    h('div', { class: 'summary-card expense' }, h('span', { class: 'summary-label' }, t('ovr-total-monthly')), h('span', { class: 'summary-value money' }, money(view.monthly))),
    h('div', { class: 'summary-card expense' }, h('span', { class: 'summary-label' }, t('ovr-total-yearly')), h('span', { class: 'summary-value money' }, money(view.yearly))),
    h('div', { class: 'summary-card' }, h('span', { class: 'summary-label' }, t('ovr-count')), h('span', { class: 'summary-value' }, String(view.rows.length)))));

  root.appendChild(h('div', { class: 'card table-card' },
    h('div', { class: 'table-toolbar ovr-toolbar' }, filter),
    view.rows.length
      ? h('table', { class: 'ovr-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, t('col-item')), h('th', { class: 'num' }, t('ovr-col-monthly')), h('th', { class: 'num' }, t('ovr-col-yearly')),
          h('th', {}, t('ovr-col-next')), h('th', {}, t('ovr-col-price')))),
        h('tbody', {}, view.rows.map(overviewRow)),
        h('tfoot', {}, h('tr', { class: 'ovr-total' },
          h('td', {}, t('ovr-total')),
          h('td', { class: 'num money', 'data-label': t('ovr-col-monthly') }, money(view.monthly)),
          h('td', { class: 'num money', 'data-label': t('ovr-col-yearly') }, money(view.yearly)),
          h('td', { class: 'ovr-empty-cell' }), h('td', { class: 'ovr-empty-cell' }))))
      : emptyState(t('ovr-empty'), 'repeat'),
    h('p', { class: 'field-hint pad' }, t('ovr-hint'))));
}

export function renderTemplates(root) {
  clear(root);
  const today = todayKey();
  const templates = store.list('templates').sort((a, b) =>
    (b.active - a.active) || (a.type === 'income' ? -1 : 0) - (b.type === 'income' ? -1 : 0) || (a.schedule.day - b.schedule.day) || a.title.localeCompare(b.title));

  root.appendChild(h('div', { class: 'view-header' },
    h('div', {}, h('h1', { class: 'view-title' }, t('nav-templates')), h('p', { class: 'view-subtitle' }, t('templates-subtitle'))),
    h('div', { class: 'header-actions tpl-header-actions' },
      templates.length ? segmented([
        { value: 'all', label: t('tpl-view-all') },
        { value: 'overview', label: t('tpl-view-overview') }
      ], mode, (v) => { mode = v; renderTemplates(root); }) : null,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openTemplateModal() }, icon('plus'), t('template-new')))));

  if (!templates.length) {
    root.appendChild(h('div', { class: 'card' }, emptyState(t('templates-empty'), 'repeat')));
    refreshIcons();
    return;
  }

  if (mode === 'overview') {
    renderOverviewMode(root, today);
    refreshIcons();
    return;
  }

  const active = templates.filter(x => x.active);
  const monthlyOut = active.filter(x => x.type === 'expense' && x.schedule.freq === 'monthly' && !x.isTransit).reduce((s, x) => s + x.amount, 0);
  const monthlyIn = active.filter(x => x.type === 'income' && x.schedule.freq === 'monthly' && !x.isTransit).reduce((s, x) => s + x.amount, 0);

  root.appendChild(h('div', { class: 'summary-strip' },
    h('div', { class: 'summary-card income' }, h('span', { class: 'summary-label' }, t('tpl-monthly-in')), h('span', { class: 'summary-value money' }, money(monthlyIn))),
    h('div', { class: 'summary-card expense' }, h('span', { class: 'summary-label' }, t('tpl-monthly-out')), h('span', { class: 'summary-value money' }, money(monthlyOut))),
    h('div', { class: `summary-card ${monthlyIn - monthlyOut < 0 ? 'alert' : ''}` }, h('span', { class: 'summary-label' }, t('tpl-monthly-net')),
      h('span', { class: `summary-value money ${monthlyIn - monthlyOut < 0 ? 'negative' : 'positive'}` }, money(monthlyIn - monthlyOut, { signed: true })))));

  root.appendChild(h('div', { class: 'card table-card' },
    h('div', { class: 'table-scroll' }, h('table', { class: 'tpl-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, t('col-item')), h('th', {}, t('col-schedule')), h('th', {}, t('col-account')),
        h('th', { class: 'num' }, t('col-amount')), h('th', { class: 'col-actions' }))),
      h('tbody', {}, templates.map(tpl => templateRow(tpl, today))))),
    h('p', { class: 'field-hint pad' }, t('templates-hint'))));
  refreshIcons();
}
