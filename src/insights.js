// Texts and rows for the runway and the alerts (ledger.js computes them),
// shared by the overview, the phone's Today tab and the notifications.

import { t, tn } from './i18n.js';
import { h, icon, money, lang } from './ui.js';
import { addDays, formatDay } from './dates.js';
import { store } from './store.js';
import { openEntryModal } from './modals.js';

export function runwayText(r) {
  if (r.status === 'negative') return t('runway-negative');
  if (r.status !== 'ok') return t('runway-no-spending');
  if (r.days > 365) return t('runway-year');
  return tn('runway-days', r.days);
}

export function runwayHint(r) {
  if (r.status === 'no-history' || !r.historyDays) return t('runway-hint-none');
  return tn('runway-hint', r.historyDays, { amount: money(r.daily) });
}

function dayText(day, today) {
  if (day === today) return t('alert-day-today');
  if (day === addDays(today, 1)) return t('alert-day-tomorrow');
  return formatDay(day, lang());
}

export function alertText(a, today) {
  if (a.kind === 'limit-near') return t('alert-limit-near', { name: a.name, percent: a.percent, spent: money(a.spent), limit: money(a.limit) });
  if (a.kind === 'limit-over') return t('alert-limit-over', { name: a.name, spent: money(a.spent), limit: money(a.limit) });
  if (a.kind === 'free-low') {
    return a.free < 0 ? t('alert-free-negative', { amount: money(a.free) }) : t('alert-free-low', { amount: money(a.free), threshold: money(a.threshold) });
  }
  if (a.kind === 'large-payment') {
    const text = t('alert-large-payment', { day: dayText(a.date, today), name: a.name || t('untitled'), amount: money(a.amount) });
    return a.reserved ? `${text}, ${t('alert-large-reserved')}` : text;
  }
  return '';
}

const ICONS = { 'limit-near': 'gauge', 'limit-over': 'alert-triangle', 'free-low': 'wallet', 'large-payment': 'calendar-clock' };

// One row per alert; a large payment opens for editing.
export function alertRows(alerts, today) {
  return alerts.map(a => {
    const entry = a.entryId ? store.find('entries', a.entryId) : null;
    const content = [icon(ICONS[a.kind] || 'info'), h('span', {}, alertText(a, today))];
    return entry
      ? h('button', { type: 'button', class: `alert-row alert-${a.level} is-link`, onclick: () => openEntryModal(entry) }, ...content)
      : h('div', { class: `alert-row alert-${a.level}` }, ...content);
  });
}
