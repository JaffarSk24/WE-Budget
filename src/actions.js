// Status changes shared by every screen, with the follow-ups that belong to
// them: asking for the real amount of an estimated payment, offering to
// split income that just arrived, undo for everything destructive.

import { store } from './store.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';
import { h, icon, money, accountLabel, categoryName, lang } from './ui.js';
import { openAllocationModal, openEntryModal, promptAmount, withUndo } from './modals.js';
import { formatDay, todayKey } from './dates.js';

export async function markDone(entry) {
  let amount = null;
  const template = entry.templateId ? store.find('templates', entry.templateId) : null;
  if (template && template.amountIsEstimate) {
    amount = await promptAmount(entry);
    if (amount === null) return;
  }
  const snap = store.snapshot();
  const today = todayKey();
  store.setStatus(entry.id, 'done', { amount, today });
  const moved = entry.date > today;
  if (entry.type === 'income' && !entry.isTransit && !entry.isAdjustment) {
    showToast(t('toast-income-done', { amount: money(amount ?? entry.amount) }), {
      type: 'success',
      duration: 10000,
      actionLabel: t('alloc-open'),
      onAction: () => openAllocationModal({ sourceAccountId: entry.accountId })
    });
  } else {
    const name = entry.title || t('untitled');
    showToast(moved ? t('toast-done-moved', { name, date: formatDay(today, lang()) }) : t('toast-done', { name }), {
      type: 'success', actionLabel: t('undo'), onAction: () => store.restore(snap)
    });
  }
}

export function toggleDone(entry) {
  if (entry.status === 'done') return store.unmarkDone(entry.id);
  if (entry.status === 'cancelled') return store.setStatus(entry.id, 'planned');
  return markDone(entry);
}

export function toggleReserve(entry) {
  if (entry.type !== 'expense' || entry.isTransit || entry.status === 'done' || entry.status === 'cancelled') return;
  store.setStatus(entry.id, entry.status === 'reserved' ? 'planned' : 'reserved');
}

export function cancelEntry(entry) {
  if (entry.status === 'cancelled') return store.setStatus(entry.id, 'planned');
  return withUndo(t('toast-cancelled', { name: entry.title || t('untitled') }), () => store.setStatus(entry.id, 'cancelled'));
}

export function deleteEntry(entry) {
  return withUndo(t('toast-entry-deleted'), () => store.remove('entries', entry.id));
}

export function statusLabel(entry) {
  return t(`status-${entry.status}`);
}

// Round status button: empty circle for planned, filled shield for
// reserved, check for done, dash for cancelled.
export function statusButton(entry) {
  const names = { planned: 'circle', reserved: 'shield-check', done: 'check-circle-2', cancelled: 'minus-circle' };
  const titles = {
    planned: t('hint-mark-done'),
    reserved: t('hint-mark-done'),
    done: t('hint-unmark'),
    cancelled: t('hint-restore')
  };
  return h('button', {
    type: 'button', class: `status-btn status-${entry.status}`, title: titles[entry.status],
    'aria-label': titles[entry.status],
    onclick: (e) => { e.stopPropagation(); toggleDone(entry); }
  }, icon(names[entry.status]));
}

export function reserveButton(entry) {
  if (entry.type !== 'expense' || entry.isTransit || entry.status === 'done' || entry.status === 'cancelled') {
    return h('span', { class: 'reserve-spacer' });
  }
  const on = entry.status === 'reserved';
  return h('button', {
    type: 'button', class: `icon-btn reserve-btn ${on ? 'on' : ''}`,
    title: on ? t('hint-unreserve') : t('hint-reserve'),
    'aria-label': on ? t('hint-unreserve') : t('hint-reserve'),
    onclick: (e) => { e.stopPropagation(); toggleReserve(entry); }
  }, icon('piggy-bank'));
}

// Compact row for lists on the overview.
export function entryListItem(entry, { showDate = true } = {}) {
  const today = todayKey();
  const overdue = (entry.status === 'planned' || entry.status === 'reserved') && entry.date < today;
  const sign = entry.type === 'income' ? 1 : entry.type === 'expense' ? -1 : 0;
  const unreserved = entry.type === 'expense' && entry.status === 'planned' && entry.amount !== 0 && !entry.isTransit;
  return h('div', {
    class: `list-entry status-row-${entry.status} ${overdue ? 'is-overdue' : ''} ${unreserved ? 'is-unreserved' : ''}`,
    ondblclick: () => openEntryModal(entry)
  },
    statusButton(entry),
    showDate ? h('span', { class: 'list-entry-date' }, formatDay(entry.date, lang())) : null,
    h('div', { class: 'list-entry-main' },
      h('span', { class: 'list-entry-title' }, entry.title || t('untitled')),
      h('span', { class: 'list-entry-meta' },
        [entry.type === 'transfer' ? `${accountLabel(entry.accountId)} → ${accountLabel(entry.toAccountId)}` : accountLabel(entry.accountId),
          entry.categoryId ? categoryName(entry.categoryId) : null,
          entry.status === 'reserved' ? t('status-reserved') : null].filter(Boolean).join(' · '))),
    h('span', { class: `list-entry-amount money ${sign > 0 ? 'positive' : sign === 0 ? 'neutral' : ''}` },
      sign === 0 ? money(entry.amount) : money(sign * entry.amount, { signed: sign > 0 })),
    reserveButton(entry),
    h('button', {
      type: 'button', class: 'icon-btn', title: t('edit'), 'aria-label': t('edit'),
      onclick: () => openEntryModal(entry)
    }, icon('pencil'))
  );
}
