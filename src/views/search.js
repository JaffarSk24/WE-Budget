// Search across the whole plan: a dialog on the computer, a full-screen
// list on the phone. The finding itself lives in src/search.js; this file
// only draws the field, the filters and the results.

import { store } from '../store.js';
import { t, tn, flow } from '../i18n.js';
import { h, clear, icon, money, refreshIcons, lang, openModal, selectEl, accountOptions, accountLabel, field } from '../ui.js';
import { searchEntries, hasActiveFilters } from '../search.js';
import { statusButton } from '../actions.js';
import { openEntryModal } from '../modals.js';
import { formatDate, todayKey } from '../dates.js';
import { live } from '../model.js';
import { categoryText, splitTooltip } from '../split-editor.js';
import { tagChips, tagFilterOptions } from '../tag-ui.js';

// Drawing thousands of rows makes typing lag; the rest is counted instead.
export const RESULT_LIMIT = 200;
const DEBOUNCE_MS = 150;

// Remembered while the app runs, so a search opened again continues where
// the person left it.
let last = { query: '', filters: {} };
let active = null;

export function isSearchOpen() {
  return Boolean(active);
}

function categorySelect(value) {
  const cats = live(store.data.categories).filter(c => !c.archived || c.id === value)
    .sort((a, b) => a.name.localeCompare(b.name, lang()));
  const group = (type, label) => ({
    group: label,
    options: cats.filter(c => c.type === type).map(c => ({ value: c.id, label: c.name }))
  });
  return selectEl([
    { value: '', label: t('search-any-category') },
    group('expense', t('type-expense')),
    group('income', t('type-income'))
  ].filter(o => !o.group || o.options.length), value || '');
}

function resultRow(entry, onOpen) {
  const today = todayKey();
  const overdue = (entry.status === 'planned' || entry.status === 'reserved') && entry.date < today;
  const sign = entry.type === 'income' ? 1 : entry.type === 'expense' ? -1 : 0;
  const where = entry.type === 'transfer'
    ? flow(accountLabel(entry.accountId), accountLabel(entry.toAccountId))
    : accountLabel(entry.accountId);
  const meta = [categoryText(entry) || null, where].filter(Boolean).join(' · ');
  return h('div', {
    class: `search-row status-row-${entry.status} ${overdue ? 'is-overdue' : ''}`,
    role: 'button', tabindex: '0',
    onclick: () => onOpen(entry),
    onkeydown: (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
        e.preventDefault();
        e.stopPropagation();
        onOpen(entry);
      }
    }
  },
    statusButton(entry),
    h('div', { class: 'search-row-main' },
      h('span', { class: 'search-row-title' }, entry.title || t('untitled')),
      h('span', { class: 'search-row-meta', title: splitTooltip(entry) },
        h('span', { class: 'search-row-date' }, formatDate(entry.date, lang())),
        meta ? ' · ' + meta : ''),
      tagChips(entry)),
    h('div', { class: 'search-row-side' },
      h('span', { class: `search-row-amount money ${sign > 0 ? 'positive' : sign === 0 ? 'neutral' : ''}` },
        sign === 0 ? money(entry.amount) : money(sign * entry.amount, { signed: sign > 0 })),
      h('span', { class: `search-row-status st-${entry.status}` }, t(`status-${entry.status}`))));
}

// Opens the search, or brings the field back into focus when it is open.
export function openSearch({ phone = false } = {}) {
  if (active) {
    active.input.focus();
    active.input.select();
    return active;
  }
  const filters = { ...last.filters };

  const input = h('input', {
    type: 'text', inputmode: 'search', class: 'search-input', value: last.query, placeholder: t('search-placeholder'),
    autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': t('search-title'),
    autofocus: true
  });
  const totals = h('div', { class: 'search-totals', role: 'status', 'aria-live': 'polite' });
  const list = h('div', { class: 'search-results' });

  const from = h('input', { type: 'date', value: filters.from || '' });
  const to = h('input', { type: 'date', value: filters.to || '' });
  const type = selectEl([
    { value: '', label: t('search-any-type') },
    { value: 'expense', label: t('type-expense') },
    { value: 'income', label: t('type-income') },
    { value: 'transfer', label: t('type-transfer') }
  ], filters.type || '');
  const account = selectEl(accountOptions({ includeArchived: true, emptyLabel: t('search-any-account') }), filters.accountId || '');
  const category = categorySelect(filters.categoryId);
  const hasTags = store.list('tags').length > 0 || Boolean(filters.tagId);
  const tag = selectEl(tagFilterOptions(t('search-any-tag'), filters.tagId || ''), filters.tagId || '');
  const status = selectEl([
    { value: '', label: t('search-any-status') },
    { value: 'planned', label: t('status-planned') },
    { value: 'reserved', label: t('status-reserved') },
    { value: 'done', label: t('status-done') },
    { value: 'cancelled', label: t('status-cancelled') }
  ], filters.status || '');
  const quick = h('input', { type: 'checkbox', checked: !!filters.quickOnly });
  const reset = h('button', { type: 'button', class: 'btn btn-secondary btn-sm search-reset' }, t('search-reset'));

  const filterBox = h('div', { class: 'search-filters' },
    field(t('search-from'), from),
    field(t('search-to'), to),
    field(t('search-type'), type),
    field(t('field-account'), account),
    field(t('field-category'), category),
    hasTags ? field(t('field-tag'), tag) : null,
    field(t('field-status'), status),
    h('div', { class: 'search-filter-end' },
      h('label', { class: 'checkbox-row' }, quick, h('span', {}, t('search-quick-only'))),
      reset));
  // On the phone the filters fold away so the results keep the screen.
  let filtersOpen = !phone || hasActiveFilters(filters);
  const filterToggle = h('button', {
    type: 'button', class: 'icon-btn search-filter-toggle', title: t('search-filters'), 'aria-label': t('search-filters'),
    onclick: () => { filtersOpen = !filtersOpen; syncFilterBox(); }
  }, icon('sliders-horizontal'));
  function syncFilterBox() {
    filterBox.hidden = !filtersOpen;
    filterToggle.classList.toggle('on', filtersOpen || hasActiveFilters(filters));
    filterToggle.setAttribute('aria-expanded', filtersOpen ? 'true' : 'false');
  }

  function readFilters() {
    filters.from = from.value || null;
    filters.to = to.value || null;
    filters.type = type.value || null;
    filters.accountId = account.value || null;
    filters.categoryId = category.value || null;
    filters.tagId = tag.value || null;
    filters.status = status.value || null;
    filters.quickOnly = quick.checked;
  }

  function openEntry(entry) {
    // The entry may have changed since the list was drawn.
    const fresh = store.find('entries', entry.id);
    if (fresh) openEntryModal(fresh);
  }

  function run() {
    last = { query: input.value, filters: { ...filters } };
    const found = searchEntries(store.data, input.value, filters);
    clear(totals);
    // append() would print a literal "null", so missing sums are filtered out.
    totals.append(...[
      h('span', { class: 'search-count' }, tn('search-found', found.count)),
      found.expense ? h('span', {}, t('search-sum-expense'), ' ', h('span', { class: 'money' }, money(-found.expense))) : null,
      found.income ? h('span', {}, t('search-sum-income'), ' ', h('span', { class: 'money positive' }, money(found.income, { signed: true }))) : null
    ].filter(Boolean));
    clear(list);
    if (!found.count) {
      list.appendChild(h('div', { class: 'empty-state' }, icon('search'),
        h('p', {}, input.value.trim() || hasActiveFilters(filters) ? t('search-none') : t('search-empty'))));
    } else {
      found.results.slice(0, RESULT_LIMIT).forEach(e => list.appendChild(resultRow(e, openEntry)));
      if (found.count > RESULT_LIMIT) {
        list.appendChild(h('p', { class: 'search-more muted small' }, tn('search-more', found.count - RESULT_LIMIT)));
      }
    }
    syncFilterBox();
    refreshIcons();
  }

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  });
  [from, to, type, account, category, tag, status, quick].forEach(el => el.addEventListener('change', () => { readFilters(); run(); }));
  reset.addEventListener('click', () => {
    from.value = ''; to.value = ''; type.value = ''; account.value = ''; category.value = ''; tag.value = ''; status.value = '';
    quick.checked = false;
    readFilters();
    run();
  });

  // Saving, marking or deleting an entry anywhere redraws the results.
  const unsubscribe = store.subscribe(() => run());

  const body = h('div', { class: 'search-body' },
    h('div', { class: 'search-bar' },
      h('div', { class: 'search-field' }, icon('search'), input),
      filterToggle),
    filterBox, totals, list);

  const modal = openModal({
    title: t('search-title'), body, wide: true, className: `search-modal ${phone ? 'is-phone-search' : ''}`.trim(),
    onClose: () => {
      clearTimeout(timer);
      unsubscribe();
      active = null;
    }
  });
  active = { modal, input };
  run();
  input.select();
  return active;
}
