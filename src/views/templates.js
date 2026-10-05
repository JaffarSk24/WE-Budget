// Recurring payments and incomes that build the plan months ahead.

import { store } from '../store.js';
import { t } from '../i18n.js';
import { h, clear, icon, money, refreshIcons, lang, emptyState, badge, accountLabel, categoryName } from '../ui.js';
import { dayInMonth, formatDay } from '../dates.js';
import { openTemplateModal } from '../modals.js';

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

function templateRow(tpl) {
  const sign = tpl.type === 'income' ? 'positive' : tpl.type === 'transfer' ? 'neutral' : '';
  return h('tr', { class: `tpl-row ${tpl.active ? '' : 'is-inactive'}`, ondblclick: () => openTemplateModal(tpl) },
    h('td', {},
      h('div', { class: 'row-title' }, tpl.title,
        tpl.isTransit ? badge(t('badge-transit'), 'badge-muted') : null,
        tpl.active ? null : badge(t('template-paused'), 'badge-muted')),
      h('div', { class: 'row-meta' }, [t(`type-${tpl.type}`), tpl.categoryId ? categoryName(tpl.categoryId) : null].filter(Boolean).join(' · '))),
    h('td', {}, describeSchedule(tpl.schedule),
      tpl.schedule.endDate ? h('div', { class: 'row-meta' }, t('sched-until', { date: formatDay(tpl.schedule.endDate, lang()) + '.' + tpl.schedule.endDate.slice(0, 4) })) : null),
    h('td', {}, tpl.type === 'transfer' ? `${accountLabel(tpl.accountId)} → ${accountLabel(tpl.toAccountId)}` : accountLabel(tpl.accountId)),
    h('td', { class: `num money ${sign}` }, (tpl.amountIsEstimate ? '≈ ' : '') + money(tpl.amount)),
    h('td', { class: 'col-actions' },
      h('button', { type: 'button', class: 'icon-btn', title: t('edit'), 'aria-label': t('edit'), onclick: () => openTemplateModal(tpl) }, icon('pencil'))));
}

export function renderTemplates(root) {
  clear(root);
  const templates = store.list('templates').sort((a, b) =>
    (b.active - a.active) || (a.type === 'income' ? -1 : 0) - (b.type === 'income' ? -1 : 0) || (a.schedule.day - b.schedule.day) || a.title.localeCompare(b.title));

  root.appendChild(h('div', { class: 'view-header' },
    h('div', {}, h('h1', { class: 'view-title' }, t('nav-templates')), h('p', { class: 'view-subtitle' }, t('templates-subtitle'))),
    h('div', { class: 'header-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openTemplateModal() }, icon('plus'), t('template-new')))));

  if (!templates.length) {
    root.appendChild(h('div', { class: 'card' }, emptyState(t('templates-empty'), 'repeat')));
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
      h('tbody', {}, templates.map(templateRow)))),
    h('p', { class: 'field-hint pad' }, t('templates-hint'))));
  refreshIcons();
}
