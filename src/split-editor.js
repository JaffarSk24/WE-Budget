// Split payments in the interface: the category label of a split entry
// ("Groceries +2" with the parts in a tooltip) and the editor of the entry
// dialog that turns the category field into rows of parts. The arithmetic
// lives in splits.js.

import { t } from './i18n.js';
import { h, clear, icon, money, moneyInput, categoryName, categoryOptions, refreshIcons } from './ui.js';
import { hasSplits, splitFields, splitRemainder } from './splits.js';

// The category as one short text: the entry's own category, and for a
// split payment how many more parts it has.
export function categoryText(entry) {
  if (!hasSplits(entry)) return entry.categoryId ? categoryName(entry.categoryId) : '';
  const name = categoryName(entry.categoryId) || t('no-category');
  return t('split-label', { name, n: entry.splits.length - 1 });
}

// One line per part, for a tooltip.
export function splitTooltip(entry) {
  if (!hasSplits(entry)) return null;
  return entry.splits.map(p => {
    const name = (p.categoryId && categoryName(p.categoryId)) || t('no-category');
    return `${name}: ${money(p.amount)}${p.note ? ` (${p.note})` : ''}`;
  }).join('\n');
}

// The label for a row's meta line; null when the entry has no category.
export function categoryLabel(entry) {
  const text = categoryText(entry);
  if (!text) return null;
  if (!hasSplits(entry)) return h('span', {}, text);
  return h('span', { class: 'split-label', title: splitTooltip(entry) }, icon('split', 'inline-icon'), ' ', text);
}

// The parts editor of the entry dialog. `categoryField` is the field that
// it replaces while on; `amount` is the entry's amount input, the parts
// have to add up to it. Returns { button, panel, reset(type), read() }:
// read() gives null while the editor is off (the category field decides),
// { error } when saving has to wait, or { splits, categoryId }.
export function splitEditor({ entry, type: startType, amount, category, categoryField }) {
  let type = startType;
  let on = false;
  const rows = [];
  const list = h('div', { class: 'split-rows' });
  const left = h('div', { class: 'split-left', role: 'status', 'aria-live': 'polite' });
  const addBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { addRow(); update(); focusLast(); } },
    icon('plus'), t('split-add'));
  const offBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => turnOff() }, t('split-remove'));
  const panel = h('div', { class: 'split-panel', hidden: true },
    h('div', { class: 'split-head' }, h('span', { class: 'split-title' }, icon('split'), t('split-title')), offBtn),
    list,
    h('div', { class: 'split-foot' }, addBtn, left));
  const button = h('button', { type: 'button', class: 'link-btn split-toggle', onclick: () => turnOn() }, icon('split'), t('split-button'));

  function focusLast() {
    const last = rows[rows.length - 1];
    if (last) setTimeout(() => last.category.focus(), 20);
  }

  function addRow(part = {}) {
    const sel = h('select', { 'aria-label': t('field-category') });
    categoryOptions(type, { emptyLabel: t('split-choose-category') }).forEach(o => sel.appendChild(h('option', { value: o.value }, o.label)));
    sel.value = part.categoryId || '';
    const sum = moneyInput({ value: part.amount ?? null });
    sum.setAttribute('aria-label', t('field-amount'));
    const note = h('input', { type: 'text', value: part.note || '', placeholder: t('split-note'), 'aria-label': t('field-note'), autocomplete: 'off' });
    const row = { category: sel, amount: sum, note, el: null };
    const remove = h('button', {
      type: 'button', class: 'icon-btn danger', title: t('split-remove-part'), 'aria-label': t('split-remove-part'),
      onclick: () => {
        rows.splice(rows.indexOf(row), 1);
        row.el.remove();
        update();
      }
    }, icon('x'));
    row.el = h('div', { class: 'split-row' }, sel, sum, note, remove);
    sum.addEventListener('input', update);
    rows.push(row);
    list.appendChild(row.el);
    refreshIcons();
  }

  // What the typed parts add up to; a part that cannot be read counts as
  // nothing until it is fixed.
  function typed() {
    return rows.map(r => ({ categoryId: r.category.value || null, amount: r.amount.value.trim() ? r.amount.readCents() : 0, note: r.note.value }));
  }

  function update() {
    if (!on) return;
    const total = amount.readCents() || 0;
    const rest = splitRemainder(total, typed().map(p => ({ amount: p.amount || 0 })));
    left.classList.toggle('is-done', rest === 0);
    left.classList.toggle('is-over', rest < 0);
    left.textContent = rest === 0 ? t('split-left-none') : rest > 0 ? t('split-left', { amount: money(rest) }) : t('split-over', { amount: money(-rest) });
  }

  function show(value) {
    on = value;
    panel.hidden = !on;
    categoryField.classList.toggle('is-split-hidden', on);
  }

  function turnOn(parts = null) {
    clear(list);
    rows.length = 0;
    if (parts) parts.forEach(p => addRow(p));
    else {
      // The category chosen so far becomes the first part; the receipt is
      // usually typed in from the top.
      addRow({ categoryId: category.value || null });
      addRow({});
    }
    show(true);
    update();
    if (!parts) setTimeout(() => rows[0].amount.focus(), 20);
  }

  // Back to one category: the largest part's, the one the entry would show.
  function turnOff() {
    const fields = splitFields(typed(), category.value || null);
    show(false);
    if (fields.categoryId && [...category.options].some(o => o.value === fields.categoryId)) category.value = fields.categoryId;
    category.focus();
  }

  amount.addEventListener('input', update);

  if (entry && hasSplits(entry) && entry.type === type) turnOn(entry.splits);

  return {
    button,
    panel,
    isOn: () => on,
    // A new type brings other categories (or none): the parts start over.
    reset(nextType) {
      if (nextType !== type && on) show(false);
      type = nextType;
      button.hidden = type === 'transfer';
    },
    read() {
      if (!on || type === 'transfer') return null;
      const parts = [];
      for (const r of rows) {
        const text = r.amount.value.trim();
        const cents = text ? r.amount.readCents() : 0;
        if (cents === null || cents < 0) return { error: t('err-amount') };
        if (cents > 0 && !r.category.value) return { error: t('err-split-category') };
        parts.push({ categoryId: r.category.value || null, amount: cents, note: r.note.value });
      }
      const rest = splitRemainder(amount.readCents() || 0, parts);
      if (rest !== 0) return { error: rest > 0 ? t('split-left', { amount: money(rest) }) : t('split-over', { amount: money(-rest) }) };
      return splitFields(parts, category.value || null);
    }
  };
}
