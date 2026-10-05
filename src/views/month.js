// Month view: the replacement for one month block of the spreadsheet.
// Rows by date, status per row, running total computed in code.

import { store } from '../store.js';
import { t, tn } from '../i18n.js';
import { h, clear, icon, money, moneyEl, accountLabel, categoryName, selectEl, accountOptions, refreshIcons, topModal, lang, badge } from '../ui.js';
import { monthRows, monthSummary, overdueEntries } from '../ledger.js';
import { addMonthsToMonth, formatDay, formatMonth, monthOf, todayKey, firstDayOfMonth, parseDayKey } from '../dates.js';
import { statusButton, reserveButton, toggleDone, toggleReserve, cancelEntry, deleteEntry, entryListItem } from '../actions.js';
import { openEntryModal, openAllocationModal } from '../modals.js';

const state = {
  month: null,
  accountId: '',
  showCancelled: true,
  selectedId: null
};

let container = null;
let visibleIds = [];

export function setMonth(month) {
  state.month = month;
}

function stat(label, valueEl, sub = null, cls = '') {
  return h('div', { class: `summary-card ${cls}` },
    h('span', { class: 'summary-label' }, label),
    h('span', { class: 'summary-value' }, valueEl),
    sub ? h('span', { class: 'summary-sub' }, sub) : null);
}

function weekdayShort(day) {
  return parseDayKey(day).toLocaleDateString(lang() === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'short' });
}

function rowFor({ entry: e, running }, today, showRunning) {
  const overdue = (e.status === 'planned' || e.status === 'reserved') && e.date < today;
  const cls = [
    'month-row', `status-row-${e.status}`,
    overdue ? 'is-overdue' : '',
    e.date === today ? 'is-today' : '',
    e.id === state.selectedId ? 'is-selected' : ''
  ].join(' ');

  const meta = [];
  if (e.type === 'transfer') meta.push(h('span', {}, t('transfer-to', { name: accountLabel(e.toAccountId) })));
  if (e.categoryId) meta.push(h('span', {}, categoryName(e.categoryId)));
  if (e.templateId) meta.push(h('span', { class: 'meta-icon', title: t('from-template') }, icon('repeat')));
  if (e.isTransit) meta.push(badge(t('badge-transit'), 'badge-muted'));
  if (e.isAdjustment) meta.push(badge(t('badge-adjustment'), 'badge-warning'));
  if (e.isQuick) meta.push(badge(t('badge-quick'), 'badge-muted'));
  if (e.status === 'reserved') meta.push(badge(t('status-reserved'), 'badge-reserved'));
  if (e.status === 'done' && e.amount !== e.plannedAmount && e.templateId) {
    meta.push(h('span', { class: 'muted' }, t('planned-was', { amount: money(e.plannedAmount) })));
  }
  if (e.note) meta.push(h('span', { class: 'muted note-snippet' }, e.note));

  const amountCell = (type) => {
    if (e.type !== type && !(type === 'expense' && e.type === 'transfer')) return h('td', { class: 'num' });
    const cls2 = e.type === 'income' ? 'positive' : e.type === 'transfer' ? 'neutral' : '';
    return h('td', { class: `num money ${cls2}` }, e.type === 'transfer' ? h('span', {}, icon('arrow-left-right', 'inline-icon'), ' ', money(e.amount)) : money(e.amount));
  };

  return h('tr', {
    class: cls,
    dataset: { id: e.id },
    onclick: () => select(e.id),
    ondblclick: () => openEntryModal(e)
  },
    h('td', { class: 'col-status' }, statusButton(e)),
    h('td', { class: 'col-date' }, h('span', {}, formatDay(e.date, lang())), h('span', { class: 'weekday' }, weekdayShort(e.date))),
    h('td', { class: 'col-title' },
      h('div', { class: 'row-title' }, e.title || t('untitled')),
      meta.length ? h('div', { class: 'row-meta' }, meta) : null),
    amountCell('expense'),
    amountCell('income'),
    h('td', { class: 'col-account' }, accountLabel(e.accountId)),
    showRunning ? h('td', { class: `num money running ${running < 0 ? 'negative' : ''}` }, money(running)) : null,
    h('td', { class: 'col-actions' },
      reserveButton(e),
      h('button', { type: 'button', class: 'icon-btn', title: t('edit'), 'aria-label': t('edit'), onclick: (ev) => { ev.stopPropagation(); openEntryModal(e); } }, icon('pencil')),
      h('button', {
        type: 'button', class: 'icon-btn', title: e.status === 'cancelled' ? t('hint-restore') : t('hint-cancel'),
        'aria-label': t('hint-cancel'), onclick: (ev) => { ev.stopPropagation(); cancelEntry(e); }
      }, icon(e.status === 'cancelled' ? 'rotate-ccw' : 'ban')),
      h('button', { type: 'button', class: 'icon-btn danger', title: t('delete'), 'aria-label': t('delete'), onclick: (ev) => { ev.stopPropagation(); deleteEntry(e); } }, icon('trash-2')))
  );
}

function select(id) {
  state.selectedId = id;
  if (!container) return;
  container.querySelectorAll('tr.month-row').forEach(tr => tr.classList.toggle('is-selected', tr.dataset.id === id));
}

export function renderMonth(root) {
  container = root;
  const today = todayKey();
  if (!state.month) state.month = monthOf(today);
  const month = state.month;
  const isCurrent = month === monthOf(today);
  const scrollY = root.closest('main') ? root.closest('main').scrollTop : 0;

  const summary = monthSummary(store.data, month);
  let rows = monthRows(store.data, month);
  if (state.accountId) {
    rows = rows.filter(r => r.entry.accountId === state.accountId || r.entry.toAccountId === state.accountId);
  }
  if (!state.showCancelled) rows = rows.filter(r => r.entry.status !== 'cancelled');
  visibleIds = rows.map(r => r.entry.id);
  const showRunning = !state.accountId;

  clear(root);

  // Header with month navigation.
  root.appendChild(h('div', { class: 'view-header' },
    h('div', {},
      h('h1', { class: 'view-title' }, formatMonth(month, lang())),
      h('p', { class: 'view-subtitle' }, t('month-subtitle'))),
    h('div', { class: 'month-nav' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-icon-only', title: t('prev-month'), 'aria-label': t('prev-month'), onclick: () => go(-1) }, icon('chevron-left')),
      h('button', { type: 'button', class: 'btn btn-secondary', disabled: isCurrent, onclick: () => { state.month = monthOf(today); renderMonth(root); } }, t('this-month')),
      h('button', { type: 'button', class: 'btn btn-secondary btn-icon-only', title: t('next-month'), 'aria-label': t('next-month'), onclick: () => go(1) }, icon('chevron-right')))
  ));

  root.appendChild(h('div', { class: 'summary-strip' },
    stat(t('sum-opening'), moneyEl(summary.opening, { colored: true })),
    stat(t('sum-income'), moneyEl(summary.income), t('sum-done', { amount: money(summary.incomeDone) }), 'income'),
    stat(t('sum-expense'), moneyEl(summary.expense), t('sum-done', { amount: money(summary.expenseDone) }), 'expense'),
    stat(t('sum-reserved'), moneyEl(summary.reserved), summary.openCount ? tn('open-count', summary.openCount) : t('all-marked')),
    stat(t('sum-closing'), moneyEl(summary.closing, { colored: true }), summary.adjustments ? t('sum-adjustments', { amount: money(summary.adjustments, { signed: true }) }) : null, summary.closing < 0 ? 'alert' : '')
  ));

  // Open entries from earlier months stay in sight until handled.
  if (isCurrent) {
    const earlier = overdueEntries(store.data, today).filter(e => e.date < firstDayOfMonth(month));
    if (earlier.length) {
      root.appendChild(h('div', { class: 'card overdue-card' },
        h('div', { class: 'card-title-row' }, icon('alert-triangle'), h('h3', {}, tn('overdue-earlier', earlier.length))),
        h('div', { class: 'list' }, earlier.map(e => entryListItem(e)))));
    }
  }

  const accountFilter = selectEl(accountOptions({ emptyLabel: t('all-accounts'), includeArchived: true }), state.accountId);
  accountFilter.addEventListener('change', () => { state.accountId = accountFilter.value; renderMonth(root); });
  const cancelledToggle = h('input', { type: 'checkbox', checked: state.showCancelled });
  cancelledToggle.addEventListener('change', () => { state.showCancelled = cancelledToggle.checked; renderMonth(root); });

  const table = h('table', { class: 'month-table' },
    h('thead', {}, h('tr', {},
      h('th', { class: 'col-status' }),
      h('th', { class: 'col-date' }, t('col-date')),
      h('th', {}, t('col-item')),
      h('th', { class: 'num' }, t('col-expense')),
      h('th', { class: 'num' }, t('col-income')),
      h('th', {}, t('col-account')),
      showRunning ? h('th', { class: 'num' }, t('col-running')) : null,
      h('th', { class: 'col-actions' }))),
    h('tbody', {}, rows.length
      ? rows.map(r => rowFor(r, today, showRunning))
      : h('tr', {}, h('td', { colspan: 8, class: 'empty-cell' }, t('month-empty')))),
    rows.length ? h('tfoot', {}, h('tr', {},
      h('td', {}), h('td', {}), h('td', {}, t('total')),
      h('td', { class: 'num money' }, money(rows.filter(r => r.entry.type === 'expense' && r.entry.status !== 'cancelled').reduce((s, r) => s + r.entry.amount, 0))),
      h('td', { class: 'num money positive' }, money(rows.filter(r => r.entry.type === 'income' && r.entry.status !== 'cancelled').reduce((s, r) => s + r.entry.amount, 0))),
      h('td', {}),
      showRunning ? h('td', { class: `num money running ${summary.closing < 0 ? 'negative' : ''}` }, money(summary.closing)) : null,
      h('td', {}))) : null
  );

  root.appendChild(h('div', { class: 'card table-card' },
    h('div', { class: 'table-toolbar' },
      accountFilter,
      h('label', { class: 'checkbox-row' }, cancelledToggle, h('span', {}, t('show-cancelled'))),
      h('div', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openAllocationModal() }, icon('split'), t('alloc-open')),
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => openEntryModal(null, { date: isCurrent ? today : firstDayOfMonth(month), accountId: state.accountId || null })
      }, icon('plus'), t('entry-add'))),
    h('div', { class: 'table-scroll' }, table)
  ));

  const isMac = (window.wePlatform && window.wePlatform.os === 'darwin') || /Mac/.test(navigator.platform || '');
  root.appendChild(h('p', { class: 'kbd-hint' }, t('month-keys', { mod: isMac ? '⌘' : 'Ctrl+' })));
  refreshIcons();
  const main = root.closest('main');
  if (main) main.scrollTop = scrollY;
}

function go(delta) {
  state.month = addMonthsToMonth(state.month, delta);
  state.selectedId = null;
  if (container) {
    renderMonth(container);
    const main = container.closest('main');
    if (main) main.scrollTop = 0;
  }
}

function selectedEntry() {
  return state.selectedId ? store.find('entries', state.selectedId) : null;
}

function moveSelection(delta) {
  if (!visibleIds.length) return;
  const idx = visibleIds.indexOf(state.selectedId);
  const next = idx === -1 ? (delta > 0 ? 0 : visibleIds.length - 1) : Math.min(visibleIds.length - 1, Math.max(0, idx + delta));
  select(visibleIds[next]);
  const tr = container && container.querySelector(`tr[data-id="${visibleIds[next]}"]`);
  if (tr) tr.scrollIntoView({ block: 'nearest' });
}

// Keyboard: works while the month view is visible and nothing else has focus.
export function handleMonthKey(e) {
  if (!container || !container.classList.contains('active') || topModal()) return false;
  const tag = (e.target && e.target.tagName) || '';
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return false;
  const entry = selectedEntry();
  switch (e.key) {
    case 'ArrowDown': moveSelection(1); return true;
    case 'ArrowUp': moveSelection(-1); return true;
    case 'ArrowLeft': go(-1); return true;
    case 'ArrowRight': go(1); return true;
    case ' ': if (entry) { toggleDone(entry); return true; } return false;
    case 'r': case 'R': case 'к': case 'К': if (entry) { toggleReserve(entry); return true; } return false;
    case 'Enter': case 'e': case 'E': case 'у': case 'У': if (entry) { openEntryModal(entry); return true; } return false;
    case 'Delete': case 'Backspace': if (entry) { deleteEntry(entry); return true; } return false;
    case 'n': case 'N': case 'т': case 'Т': openEntryModal(null, { date: state.month === monthOf(todayKey()) ? todayKey() : firstDayOfMonth(state.month) }); return true;
    default: return false;
  }
}
