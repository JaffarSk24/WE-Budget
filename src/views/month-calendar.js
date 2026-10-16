// Month as a calendar grid: the same entries as the table, laid out in weeks
// from Monday to Sunday. A day opens its list with the usual row actions; an
// open entry can be dragged to another day to move it.

import { store } from '../store.js';
import { t, tn } from '../i18n.js';
import { h, clear, money, openModal, refreshIcons, lang, emptyState } from '../ui.js';
import { calendarWeeks } from '../calendar.js';
import { budgetFlow, compareEntries, frozenAccounts, isOpen } from '../ledger.js';
import { entryListItem } from '../actions.js';
import { openEntryModal, withUndo } from '../modals.js';
import { addDays, firstDayOfMonth, formatDate, formatDayLong, formatWeekdayShort, lastDayOfMonth, monthOf, weekdayIndex } from '../dates.js';
import { live } from '../model.js';

export const MAX_DAY_ENTRIES = 3;

// The days the grid shows for a month, from the Monday before the 1st to the
// Sunday after the last day, so the filter can fetch the neighbours' entries.
export function calendarRange(month) {
  const first = firstDayOfMonth(month);
  const last = lastDayOfMonth(month);
  return { from: addDays(first, -weekdayIndex(first)), to: addDays(last, 6 - weekdayIndex(last)) };
}

let draggingId = null;

function weekdayNames() {
  // 5 October 2026 is a Monday.
  return Array.from({ length: 7 }, (_, i) => formatWeekdayShort(addDays('2026-10-05', i), lang()));
}

// Income and expense differ by sign as well as by colour; a transfer gets
// an arrow and no sign.
function signedAmount(e, opts = {}) {
  if (e.type === 'income') return money(e.amount, { signed: true, ...opts });
  if (e.type === 'expense') return money(-e.amount, opts);
  return `⇄ ${money(e.amount, opts)}`;
}

function entryChip(e) {
  const movable = isOpen(e);
  const chip = h('button', {
    type: 'button',
    class: `cal-entry cal-${e.type} status-row-${e.status} ${movable ? 'is-movable' : ''}`,
    draggable: movable ? 'true' : 'false',
    title: `${e.title || t('untitled')}: ${signedAmount(e)} (${t(`status-${e.status}`)})`,
    dataset: { id: e.id },
    onclick: (ev) => { ev.stopPropagation(); openEntryModal(e); }
  },
    h('span', { class: `cal-dot status-dot-${e.status}`, 'aria-hidden': 'true' }),
    h('span', { class: 'cal-entry-title' }, e.title || t('untitled')),
    h('span', { class: `cal-entry-amount money ${e.type === 'income' ? 'positive' : e.type === 'transfer' ? 'neutral' : ''}` }, signedAmount(e, { decimals: false })));
  if (movable) {
    chip.addEventListener('dragstart', (ev) => {
      draggingId = e.id;
      chip.classList.add('is-dragging');
      try { ev.dataTransfer.setData('text/plain', e.id); ev.dataTransfer.effectAllowed = 'move'; } catch (x) { /* the id is kept above */ }
    });
    chip.addEventListener('dragend', () => {
      draggingId = null;
      chip.classList.remove('is-dragging');
      document.querySelectorAll('.cal-day.is-drop-target').forEach(c => c.classList.remove('is-drop-target'));
    });
  }
  return chip;
}

// Moving keeps everything else about the entry; a template's entry keeps its
// occurrence, so the template does not create the old day again.
export function moveEntryTo(id, day) {
  const e = store.find('entries', id);
  if (!e || !isOpen(e) || e.date === day) return;
  withUndo(t('cal-toast-moved', { name: e.title || t('untitled'), date: formatDate(day, lang()) }), () => store.update('entries', id, { date: day }));
}

function dayCell(d, { today, focusDay, onOpenDay, onFocusDay }) {
  const shown = d.entries.slice(0, MAX_DAY_ENTRIES);
  const more = d.entries.length - shown.length;
  const cls = [
    'cal-day',
    d.inMonth ? '' : 'is-other',
    d.day === today ? 'is-today' : '',
    d.isWeekend ? 'is-weekend' : '',
    d.day === focusDay ? 'is-focused' : '',
    d.entries.some(e => isOpen(e) && e.date < today) ? 'has-overdue' : ''
  ].filter(Boolean).join(' ');
  const label = [formatDayLong(d.day, lang()), d.entries.length ? tn('cal-entries', d.entries.length) : t('cal-no-entries'),
    d.net ? money(d.net, { signed: true }) : null].filter(Boolean).join(', ');
  const cell = h('div', {
    class: cls, role: 'gridcell', tabindex: d.day === focusDay ? '0' : '-1', 'aria-label': label,
    'aria-selected': d.day === focusDay ? 'true' : 'false', dataset: { day: d.day },
    onclick: () => { onFocusDay(d.day); onOpenDay(d.day); }
  },
    h('div', { class: 'cal-day-head' },
      h('span', { class: 'cal-day-num' }, String(Number(d.day.slice(8, 10)))),
      d.net ? h('span', { class: `cal-day-net money ${d.net > 0 ? 'positive' : 'negative'}` }, money(d.net, { signed: true, decimals: false })) : null),
    h('div', { class: 'cal-day-entries' },
      shown.map(entryChip),
      more > 0 ? h('button', { type: 'button', class: 'cal-more', onclick: (ev) => { ev.stopPropagation(); onFocusDay(d.day); onOpenDay(d.day); } }, t('cal-more', { n: more })) : null));

  cell.addEventListener('dragover', (ev) => {
    if (!draggingId) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'move'; } catch (x) { /* not essential */ }
    cell.classList.add('is-drop-target');
  });
  cell.addEventListener('dragleave', (ev) => {
    if (!cell.contains(ev.relatedTarget)) cell.classList.remove('is-drop-target');
  });
  cell.addEventListener('drop', (ev) => {
    ev.preventDefault();
    cell.classList.remove('is-drop-target');
    const id = draggingId;
    draggingId = null;
    if (id) moveEntryTo(id, d.day);
  });
  return cell;
}

// The grid for `month` with `entries` already filtered by the toolbar.
export function calendarGrid({ month, entries, today, focusDay, onOpenDay, onFocusDay }) {
  const frozen = frozenAccounts(store.data);
  const weeks = calendarWeeks(month, entries, { flow: e => budgetFlow(e, frozen) });
  return h('div', { class: 'cal', role: 'grid', 'aria-label': t('cal-label') },
    h('div', { class: 'cal-head', role: 'row' }, weekdayNames().map((name, i) => h('div', { class: `cal-head-day ${i >= 5 ? 'is-weekend' : ''}`, role: 'columnheader' }, name))),
    weeks.map(w => h('div', { class: 'cal-week', role: 'row' }, w.days.map(d => dayCell(d, { today, focusDay, onOpenDay, onFocusDay })))));
}

// One day's list with the row actions of the table. It stays open and
// follows changes, so marking several entries in a row works.
export function openDayPanel(day, entriesOf, { accountId = null } = {}) {
  const list = h('div', { class: 'list cal-day-list' });
  const totals = h('div', { class: 'cal-day-totals muted small' });
  const frozen = () => frozenAccounts(store.data);
  const refresh = () => {
    const entries = entriesOf(day).slice().sort(compareEntries);
    clear(list);
    if (!entries.length) list.appendChild(emptyState(t('cal-no-entries'), 'calendar'));
    else entries.forEach(e => list.appendChild(entryListItem(e, { showDate: false })));
    let income = 0;
    let expense = 0;
    const f = frozen();
    entries.forEach(e => {
      const flow = budgetFlow(e, f);
      if (!flow) return;
      if (flow.type === 'income') income += flow.amount;
      else expense += flow.amount;
    });
    clear(totals);
    if (income) totals.appendChild(h('span', {}, t('sel-income'), ' ', h('strong', { class: 'money positive' }, money(income))));
    if (expense) totals.appendChild(h('span', {}, t('sel-expense'), ' ', h('strong', { class: 'money' }, money(expense))));
    refreshIcons();
  };
  const unsubscribe = store.subscribe(() => refresh());
  refresh();
  openModal({
    title: formatDayLong(day, lang()),
    className: 'cal-day-modal',
    body: h('div', { class: 'cal-day-body' }, totals, list),
    onClose: unsubscribe,
    actions: [
      { label: t('close'), onClick: (m) => m.close() },
      { label: t('entry-add'), kind: 'primary', onClick: () => openEntryModal(null, { date: day, accountId }) }
    ]
  });
}

// Entries of the store between two days that pass the month's filters.
export function filteredEntries(from, to, passes) {
  return live(store.data.entries).filter(e => e.date >= from && e.date <= to && passes(e));
}

// Keys on the calendar: arrows move between days (across months too),
// Enter opens the focused day, N adds an entry on it. Returns the new
// focused day, 'open' or 'new', or null when the key is not ours.
export function calendarKeyAction(key, focusDay) {
  const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (key in steps) return { move: addDays(focusDay, steps[key]) };
  if (key === 'Enter' || key === ' ') return { open: focusDay };
  if (key === 'Home') return { move: firstDayOfMonth(monthOf(focusDay)) };
  if (key === 'End') return { move: lastDayOfMonth(monthOf(focusDay)) };
  return null;
}
