// Month view: the replacement for one month block of the spreadsheet.
// Rows by date, status per row, running total computed in code. Rows can be
// ticked for actions on several at once; the bar at the bottom adds them up
// per account, which tells how much has to go to each account.

import { store } from '../store.js';
import { t, tn } from '../i18n.js';
import { h, clear, icon, money, moneyEl, accountLabel, categoryName, selectEl, accountOptions, refreshIcons, topModal, lang, badge } from '../ui.js';
import { monthRows, monthSummary, overdueEntries } from '../ledger.js';
import { addMonthsToMonth, formatDay, formatMonth, monthOf, todayKey, firstDayOfMonth, parseDayKey } from '../dates.js';
import { statusButton, reserveButton, toggleDone, toggleReserve, cancelEntry, deleteEntry, entryListItem } from '../actions.js';
import { openEntryModal, openAllocationModal, openBulkDateModal, openBulkAccountModal, withUndo } from '../modals.js';
import { live } from '../model.js';

const state = {
  month: null,
  accountId: '',
  showCancelled: true,
  // Done rows sit folded under one line so the plan ahead stays in focus.
  showDone: false,
  selectedId: null,
  checked: new Set(),
  anchor: null
};

let container = null;
let visibleIds = [];

export function setMonth(month) {
  state.month = month;
  state.checked.clear();
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

function rerender() {
  if (container) renderMonth(container);
}

// ---------- ticking rows ----------

function toggleCheck(id, withShift) {
  const on = !state.checked.has(id);
  if (withShift && state.anchor && visibleIds.includes(state.anchor)) {
    // Shift-click ticks (or unticks) everything between the last click and this row.
    const a = visibleIds.indexOf(state.anchor);
    const b = visibleIds.indexOf(id);
    visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => (on ? state.checked.add(x) : state.checked.delete(x)));
  } else if (on) {
    state.checked.add(id);
  } else {
    state.checked.delete(id);
  }
  state.anchor = id;
  rerender();
}

function setAll(on) {
  if (on) visibleIds.forEach(id => state.checked.add(id));
  else state.checked.clear();
  rerender();
}

function checkedEntries() {
  const ids = new Set(visibleIds.filter(id => state.checked.has(id)));
  return live(store.data.entries).filter(e => ids.has(e.id));
}

function bulk(messageKey, action) {
  const ids = checkedEntries().map(e => e.id);
  if (!ids.length) return;
  withUndo(t(messageKey, { n: ids.length }), () => action(ids));
}

function selectionBar() {
  const entries = checkedEntries();
  if (!entries.length) return null;
  const counted = entries.filter(e => e.status !== 'cancelled');
  const expense = counted.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const income = counted.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const byAccount = new Map();
  counted.filter(e => e.type === 'expense' && e.accountId && e.amount > 0).forEach(e => {
    byAccount.set(e.accountId, (byAccount.get(e.accountId) || 0) + e.amount);
  });
  const accounts = [...byAccount.entries()].sort((a, b) => b[1] - a[1]);
  const plannedExpenses = entries.filter(e => e.type === 'expense' && e.status === 'planned' && e.amount > 0).map(e => e.id);

  const action = (iconName, label, onClick, cls = 'btn-secondary') =>
    h('button', { type: 'button', class: `btn ${cls} btn-sm`, onclick: onClick }, icon(iconName), label);

  return h('div', { class: 'selection-bar', role: 'region', 'aria-label': t('sel-region') },
    h('div', { class: 'sel-summary' },
      h('div', { class: 'sel-totals' },
        h('strong', {}, tn('sel-count', entries.length)),
        expense ? h('span', {}, t('sel-expense'), ' ', h('strong', { class: 'money' }, money(expense))) : null,
        income ? h('span', {}, t('sel-income'), ' ', h('strong', { class: 'money positive' }, money(income))) : null),
      accounts.length ? h('div', { class: 'sel-accounts' },
        h('span', { class: 'muted' }, t('sel-by-account')),
        accounts.map(([id, sum]) => h('span', { class: 'sel-chip' }, accountLabel(id), h('strong', { class: 'money' }, money(sum))))) : null),
    h('div', { class: 'sel-actions' },
      action('check-circle-2', t('sel-done'), () => bulk('toast-bulk-done', ids => store.bulkSetStatus(ids, 'done'))),
      action('piggy-bank', t('sel-reserve'), () => bulk('toast-bulk-reserved', ids => store.bulkSetStatus(ids, 'reserved'))),
      action('circle', t('sel-planned'), () => bulk('toast-bulk-planned', ids => store.bulkSetStatus(ids, 'planned'))),
      action('ban', t('sel-cancel'), () => bulk('toast-bulk-cancelled', ids => store.bulkSetStatus(ids, 'cancelled'))),
      action('calendar', t('sel-date'), () => openBulkDateModal(entries.map(e => e.id))),
      action('wallet', t('sel-account'), () => openBulkAccountModal(entries.map(e => e.id))),
      plannedExpenses.length ? action('split', t('sel-split'), () => openAllocationModal({ preselect: plannedExpenses })) : null,
      action('trash-2', t('delete'), () => { bulk('toast-bulk-deleted', ids => store.bulkRemove(ids)); state.checked.clear(); }, 'btn-danger'),
      h('button', { type: 'button', class: 'icon-btn', title: t('sel-clear'), 'aria-label': t('sel-clear'), onclick: () => setAll(false) }, icon('x'))));
}

// ---------- rows ----------

// A payment still waiting for money: planned, an expense, not zero, and not
// pass-through money (that is paid by its own pair).
export function isUnreserved(e) {
  return e.type === 'expense' && e.status === 'planned' && e.amount !== 0 && !e.isTransit;
}

// Real money flows only, the same rule as the summary cards: adjustments
// and pass-through money are neither income nor expense.
function flowSum(entries, type) {
  return entries
    .filter(e => e.type === type && e.status !== 'cancelled' && !e.isAdjustment && !e.isTransit)
    .reduce((s, e) => s + e.amount, 0);
}

function doneSpoiler(doneRows, columns) {
  const entries = doneRows.map(r => r.entry);
  const expense = flowSum(entries, 'expense');
  const income = flowSum(entries, 'income');
  const toggle = () => { state.showDone = !state.showDone; rerender(); };
  return h('tr', { class: `done-spoiler ${state.showDone ? 'is-open' : ''}`, onclick: toggle },
    h('td', { colspan: columns },
      h('div', { class: 'spoiler-inner' },
        icon(state.showDone ? 'chevron-down' : 'chevron-right'),
        icon('check-circle-2', 'spoiler-check'),
        h('strong', {}, t('done-group', { n: entries.length })),
        expense ? h('span', { class: 'muted' }, t('done-group-expense', { amount: money(expense) })) : null,
        income ? h('span', { class: 'muted' }, t('done-group-income', { amount: money(income) })) : null,
        h('span', { class: 'spoiler-action' }, state.showDone ? t('done-group-hide') : t('done-group-show')))));
}

function rowFor({ entry: e, running }, today, showRunning) {
  const overdue = (e.status === 'planned' || e.status === 'reserved') && e.date < today;
  const checked = state.checked.has(e.id);
  const cls = [
    'month-row', `status-row-${e.status}`,
    overdue ? 'is-overdue' : '',
    e.date === today ? 'is-today' : '',
    e.id === state.selectedId ? 'is-selected' : '',
    checked ? 'is-checked' : '',
    e.amount === 0 ? 'is-zero' : '',
    isUnreserved(e) ? 'is-unreserved' : ''
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

  const box = h('input', { type: 'checkbox', checked, 'aria-label': t('sel-row') });
  box.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    toggleCheck(e.id, ev.shiftKey);
  });

  return h('tr', {
    class: cls,
    dataset: { id: e.id },
    onclick: (ev) => {
      // Cmd/Ctrl-click ticks a row without the checkbox, like in a file list.
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey) {
        ev.preventDefault();
        toggleCheck(e.id, ev.shiftKey);
        return;
      }
      select(e.id);
    },
    ondblclick: () => openEntryModal(e)
  },
    h('td', { class: 'col-select' }, box),
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
  const main = root.closest('main');
  const scrollY = main ? main.scrollTop : 0;
  const pageY = window.scrollY;

  const summary = monthSummary(store.data, month);
  let rows = monthRows(store.data, month);
  if (state.accountId) {
    rows = rows.filter(r => r.entry.accountId === state.accountId || r.entry.toAccountId === state.accountId);
  }
  if (!state.showCancelled) rows = rows.filter(r => r.entry.status !== 'cancelled');
  const doneRows = rows.filter(r => r.entry.status === 'done');
  const openRows = rows.filter(r => r.entry.status !== 'done');
  const shownRows = (state.showDone ? doneRows : []).concat(openRows);
  visibleIds = shownRows.map(r => r.entry.id);
  // Ticks survive edits, but not rows that left the view.
  [...state.checked].forEach(id => { if (!visibleIds.includes(id)) state.checked.delete(id); });
  const showRunning = !state.accountId;

  clear(root);

  root.appendChild(h('div', { class: 'view-header' },
    h('div', {},
      h('h1', { class: 'view-title' }, formatMonth(month, lang())),
      h('p', { class: 'view-subtitle' }, t('month-subtitle'))),
    h('div', { class: 'month-nav' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-icon-only', title: t('prev-month'), 'aria-label': t('prev-month'), onclick: () => go(-1) }, icon('chevron-left')),
      h('button', { type: 'button', class: 'btn btn-secondary', disabled: isCurrent, onclick: () => { setMonth(monthOf(today)); renderMonth(root); } }, t('this-month')),
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
  accountFilter.addEventListener('change', () => { state.accountId = accountFilter.value; state.checked.clear(); renderMonth(root); });
  const cancelledToggle = h('input', { type: 'checkbox', checked: state.showCancelled });
  cancelledToggle.addEventListener('change', () => { state.showCancelled = cancelledToggle.checked; renderMonth(root); });

  const checkedCount = visibleIds.filter(id => state.checked.has(id)).length;
  const headBox = h('input', { type: 'checkbox', checked: visibleIds.length > 0 && checkedCount === visibleIds.length, 'aria-label': t('sel-all') });
  headBox.indeterminate = checkedCount > 0 && checkedCount < visibleIds.length;
  const columns = showRunning ? 9 : 8;
  headBox.addEventListener('change', () => setAll(headBox.checked));

  const sumOf = (type) => flowSum(rows.map(r => r.entry), type);
  const table = h('table', { class: 'month-table' },
    h('thead', {}, h('tr', {},
      h('th', { class: 'col-select' }, visibleIds.length ? headBox : null),
      h('th', { class: 'col-status' }),
      h('th', { class: 'col-date' }, t('col-date')),
      h('th', {}, t('col-item')),
      h('th', { class: 'num' }, t('col-expense')),
      h('th', { class: 'num' }, t('col-income')),
      h('th', {}, t('col-account')),
      showRunning ? h('th', { class: 'num' }, t('col-running')) : null,
      h('th', { class: 'col-actions' }))),
    h('tbody', {}, rows.length
      ? [
        doneRows.length ? doneSpoiler(doneRows, columns) : null,
        ...shownRows.map(r => rowFor(r, today, showRunning))
      ]
      : h('tr', {}, h('td', { colspan: columns, class: 'empty-cell' }, t('month-empty')))),
    rows.length ? h('tfoot', {}, h('tr', {},
      h('td', {}), h('td', {}), h('td', {}), h('td', {}, t('total')),
      h('td', { class: 'num money' }, money(sumOf('expense'))),
      h('td', { class: 'num money positive' }, money(sumOf('income'))),
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
  const bar = selectionBar();
  if (bar) root.appendChild(bar);
  refreshIcons();
  if (main) main.scrollTop = scrollY;
  if (window.scrollY !== pageY) window.scrollTo(0, pageY);
}

function go(delta) {
  setMonth(addMonthsToMonth(state.month, delta));
  state.selectedId = null;
  if (container) {
    renderMonth(container);
    const main = container.closest('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
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
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return false;
  if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф')) {
    setAll(true);
    return true;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const entry = selectedEntry();
  switch (e.key) {
    case 'Escape': if (state.checked.size) { setAll(false); return true; } return false;
    case 'ArrowDown': moveSelection(1); return true;
    case 'ArrowUp': moveSelection(-1); return true;
    case 'ArrowLeft': go(-1); return true;
    case 'ArrowRight': go(1); return true;
    case ' ': if (entry) { toggleDone(entry); return true; } return false;
    case 'x': case 'X': case 'ч': case 'Ч': if (entry) { toggleCheck(entry.id, false); return true; } return false;
    case 'r': case 'R': case 'к': case 'К': if (entry) { toggleReserve(entry); return true; } return false;
    case 'Enter': case 'e': case 'E': case 'у': case 'У': if (entry) { openEntryModal(entry); return true; } return false;
    case 'Delete': case 'Backspace': if (entry) { deleteEntry(entry); return true; } return false;
    case 'n': case 'N': case 'т': case 'Т': openEntryModal(null, { date: state.month === monthOf(todayKey()) ? todayKey() : firstDayOfMonth(state.month) }); return true;
    default: return false;
  }
}
