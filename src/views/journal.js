// The change journal screen: what changed on this device, day by day, with
// a way to take any step back. Opened from Settings > Data on the computer
// and from the More tab on the phone.

import { store } from '../store.js';
import { t, tn } from '../i18n.js';
import { showToast } from '../toast.js';
import { h, clear, icon, refreshIcons, lang, openModal, selectEl, badge } from '../ui.js';
import { formatDayLong, formatTime } from '../dates.js';
import { journal } from '../journal-log.js';
import {
  COLLECTION_GROUPS, JOURNAL_SOURCES, describeBatch, describeChange, describePatch, fieldRows, filterBatches,
  groupBatches, groupByDay, patchChange, recordChange, restoreVersion, revertBatch, makeItems
} from '../journal.js';

const PAGE = 60;
const ITEMS_SHOWN = 40;
const CONFIRM_SHOWN = 30;

let active = null;

function sourceBadge(source) {
  return badge(t(`journal-source-${source}`), `journal-source source-${source}`);
}

// Applies patches as one new change, with the usual undo in the toast.
function apply(patches, message) {
  const snap = store.snapshot();
  store.applyPatches(patches, { source: 'restore' });
  showToast(message, { type: 'success', actionLabel: t('undo'), onAction: () => store.restore(snap) });
}

function fieldList(item) {
  const rows = fieldRows(item);
  return rows.length ? h('dl', { class: 'journal-fields' }, rows.map(r => [
    h('dt', {}, r.label),
    h('dd', {}, h('span', { class: 'journal-from' }, r.from), ' → ', h('span', { class: 'journal-to' }, r.to))
  ])) : null;
}

// What the patches will do, field by field.
function lines(patches) {
  const items = patches.map(p => patchChange(p)).filter(Boolean);
  return h('ul', { class: 'journal-confirm-list' },
    items.slice(0, CONFIRM_SHOWN).map(item => h('li', {}, describeChange(item), fieldList(item))),
    items.length > CONFIRM_SHOWN ? h('li', { class: 'muted' }, t('journal-list-more', { n: items.length - CONFIRM_SHOWN })) : null);
}

// What changed in a record after the step being undone.
function laterChange(conflict) {
  const change = recordChange(conflict.item.collection, conflict.item.after, conflict.current);
  return change ? describeChange(makeItems([change])[0]) : '';
}

export function confirmUndo(batch) {
  const { patches, conflicts } = revertBatch(store.data, batch.items, { force: true });
  if (!patches.length) {
    showToast(t('journal-nothing-to-undo'), { type: 'info' });
    return null;
  }
  const conflicted = new Set(conflicts.map(c => `${c.item.collection}|${c.item.recordId}`));
  const clean = patches.filter(p => !conflicted.has(`${p.collection}|${p.id}`));
  const body = h('div', { class: 'journal-confirm' },
    clean.length ? [h('p', {}, t('journal-confirm-intro')), lines(clean)] : null,
    conflicts.length ? h('div', { class: 'banner banner-warning journal-conflicts' },
      icon('alert-triangle'),
      h('div', {},
        h('p', {}, t('journal-conflict-intro')),
        h('ul', { class: 'journal-confirm-list' }, conflicts.slice(0, CONFIRM_SHOWN).map(c => h('li', {},
          h('div', {}, describePatch({ collection: c.item.collection, id: c.item.recordId, record: c.target })),
          h('div', { class: 'muted small' }, t('journal-conflict-now', { text: laterChange(c) }))))))) : null);
  const actions = [{ label: t('cancel'), onClick: (m) => m.close() }];
  if (conflicts.length && clean.length) {
    actions.push({ label: t('journal-undo-rest'), onClick: (m) => { m.close(); apply(clean, t('journal-undone')); } });
  }
  actions.push({
    label: conflicts.length ? t('journal-undo-all') : t('journal-undo-confirm'),
    kind: conflicts.length ? 'danger' : 'primary',
    onClick: (m) => { m.close(); apply(patches, t('journal-undone')); }
  });
  return openModal({ title: t('journal-undo-title'), body, actions, className: 'journal-confirm-modal' });
}

export function confirmRestore(item) {
  const patch = restoreVersion(store.data, item);
  if (!patch) return null;
  return openModal({
    title: t('journal-restore-title'),
    body: h('div', { class: 'journal-confirm' }, h('p', {}, t('journal-confirm-intro')), lines([patch])),
    className: 'journal-confirm-modal',
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      { label: t('journal-restore-version'), kind: 'primary', onClick: (m) => { m.close(); apply([patch], t('journal-restored')); } }
    ]
  });
}

// `alone`: the only change of its step, already told in the step's line.
function itemView(item, alone) {
  const fields = fieldList(item);
  const canRestore = Boolean(restoreVersion(store.data, item));
  if (alone && !fields && !canRestore) return null;
  return h('li', { class: 'journal-item' },
    alone ? null : h('div', { class: 'journal-item-text' }, describeChange(item)),
    fields,
    canRestore ? h('div', { class: 'journal-item-foot' }, h('button', {
      type: 'button', class: 'btn btn-secondary btn-sm journal-restore', onclick: () => confirmRestore(item)
    }, icon('history'), t('journal-restore-version'))) : null);
}

function batchView(batch, open, toggle) {
  const count = batch.items.length;
  return h('div', { class: `journal-batch ${open ? 'is-open' : ''}`.trim() },
    h('div', { class: 'journal-batch-row' },
      h('button', {
        type: 'button', class: 'journal-batch-head', 'aria-expanded': open ? 'true' : 'false', onclick: toggle
      },
        h('span', { class: 'journal-time' }, formatTime(batch.at, lang())),
        h('span', { class: 'journal-summary' }, describeBatch(batch)),
        h('span', { class: 'journal-meta' },
          sourceBadge(batch.source),
          count > 1 ? h('span', { class: 'count-pill' }, count) : null),
        icon(open ? 'chevron-down' : 'chevron-right', 'journal-chevron')),
      h('button', {
        type: 'button', class: 'icon-btn journal-undo-icon', title: t('journal-undo-batch'), 'aria-label': t('journal-undo-batch'),
        onclick: () => confirmUndo(batch)
      }, icon('rotate-ccw'))),
    open ? h('div', { class: 'journal-batch-body' },
      h('ul', { class: 'journal-items' },
        batch.items.slice(0, ITEMS_SHOWN).map(item => itemView(item, count === 1)),
        count > ITEMS_SHOWN ? h('li', { class: 'muted small' }, t('journal-list-more', { n: count - ITEMS_SHOWN })) : null),
      h('div', { class: 'journal-batch-actions' },
        h('span', { class: 'muted small' }, tn('journal-records', count)),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => confirmUndo(batch) },
          icon('rotate-ccw'), t('journal-undo-batch')))) : null);
}

export function openJournal() {
  if (active) return active;
  const state = { batches: null, filters: { group: '', source: '', query: '' }, open: new Set(), limit: PAGE };

  const input = h('input', {
    type: 'text', inputmode: 'search', class: 'search-input journal-search-input', placeholder: t('journal-search-placeholder'),
    autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': t('journal-search-placeholder')
  });
  const group = selectEl([{ value: '', label: t('journal-group-all') },
    ...[...Object.keys(COLLECTION_GROUPS), 'other'].map(g => ({ value: g, label: t(`journal-group-${g}`) }))], '',
  { 'aria-label': t('journal-filter-collection') });
  const source = selectEl([{ value: '', label: t('journal-source-all') },
    ...JOURNAL_SOURCES.map(s => ({ value: s, label: t(`journal-source-${s}`) }))], '',
  { 'aria-label': t('journal-filter-source') });
  const list = h('div', { class: 'journal-list' });

  function render() {
    clear(list);
    if (!state.batches) {
      list.appendChild(h('p', { class: 'muted journal-loading' }, t('journal-loading')));
      return;
    }
    if (!state.batches.length) {
      list.appendChild(h('div', { class: 'empty-state' }, icon('history'), h('p', {}, t('journal-empty'))));
      refreshIcons();
      return;
    }
    const found = filterBatches(state.batches, state.filters, store.data);
    if (!found.length) {
      list.appendChild(h('div', { class: 'empty-state' }, icon('search'), h('p', {}, t('journal-nothing-found'))));
      refreshIcons();
      return;
    }
    groupByDay(found.slice(0, state.limit)).forEach(({ day, batches }) => {
      list.appendChild(h('section', { class: 'journal-day' },
        h('h4', { class: 'journal-day-title' }, formatDayLong(day, lang())),
        batches.map(b => batchView(b, state.open.has(b.batchId), () => {
          if (state.open.has(b.batchId)) state.open.delete(b.batchId);
          else state.open.add(b.batchId);
          render();
        }))));
    });
    if (found.length > state.limit) {
      list.appendChild(h('div', { class: 'journal-more' }, h('button', {
        type: 'button', class: 'btn btn-secondary', onclick: () => { state.limit += PAGE; render(); }
      }, t('journal-show-more'))));
    }
    refreshIcons();
  }

  async function load() {
    const items = await journal.items();
    state.batches = groupBatches(items);
    render();
  }

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.filters.query = input.value; state.limit = PAGE; render(); }, 200);
  });
  group.addEventListener('change', () => { state.filters.group = group.value; state.limit = PAGE; render(); });
  source.addEventListener('change', () => { state.filters.source = source.value; state.limit = PAGE; render(); });

  // A new step (an undo from here included) shows up at once.
  const offJournal = journal.onChange(() => { load(); });

  const body = h('div', { class: 'journal-body' },
    h('div', { class: 'journal-bar' },
      h('div', { class: 'search-field journal-search' }, icon('search'), input),
      group, source),
    h('p', { class: 'muted small journal-note' }, t('journal-local-note')),
    list);

  const modal = openModal({
    title: t('journal-title'), body, wide: true, className: 'journal-modal',
    onClose: () => {
      clearTimeout(timer);
      offJournal();
      active = null;
    }
  });
  active = modal;
  render();
  load();
  return modal;
}
