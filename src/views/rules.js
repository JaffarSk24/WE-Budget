// Category rules: the list in Settings, the rule dialog and the 'Always
// for this text' shortcut of the statement import.

import { store } from '../store.js';
import { t, flowArrow } from '../i18n.js';
import { showToast } from '../toast.js';
import {
  h, icon, money, moneyInput, openModal, field, selectEl, accountOptions, categoryOptions,
  categoryName, accountLabel
} from '../ui.js';
import { makeRule, live, nowIso } from '../model.js';
import { applyRules, sortRules, suggestRuleText, cleanTitle } from '../rules.js';
import { withUndo } from '../modals.js';

function nextOrder() {
  return live(store.data.rules).reduce((max, r) => Math.max(max, r.order ?? 0), 0) + 1;
}

// A rule made from a concrete payment goes first: the person has just
// overruled whatever rule matched that payment before.
function firstOrder() {
  return live(store.data.rules).reduce((min, r) => Math.min(min, r.order ?? 0), 1) - 1;
}

// Categories of both kinds for a rule that fits any payment type.
function ruleCategoryOptions(type) {
  if (type === 'expense' || type === 'income') return categoryOptions(type, { emptyLabel: t('choose-category') });
  return [
    { value: '', label: t('choose-category') },
    { group: t('type-expense'), options: categoryOptions('expense') },
    { group: t('type-income'), options: categoryOptions('income') }
  ];
}

function fillSelect(sel, options, value) {
  const next = selectEl(options, value);
  sel.replaceChildren(...next.childNodes);
  sel.value = value || '';
  if (sel.value !== (value || '')) sel.value = '';
}

export function ruleSummary(rule) {
  const where = t(`rule-field-${rule.field || 'any'}`);
  const how = t(`rule-match-${rule.match || 'contains'}`);
  const limits = [];
  if (rule.minAmount) limits.push(t('rule-from', { amount: money(rule.minAmount) }));
  if (rule.maxAmount) limits.push(t('rule-to', { amount: money(rule.maxAmount) }));
  return [`${where}, ${how}`, ...limits].join(' · ');
}

// The rule dialog. `defaults` prefill a new rule (from the import).
export function openRuleModal(rule = null, defaults = {}) {
  const src = rule || makeRule(defaults);
  const text = h('input', { type: 'text', value: src.text, autocomplete: 'off', placeholder: t('rule-text-placeholder') });
  const fieldSel = selectEl(['any', 'title', 'note'].map(v => ({ value: v, label: t(`rule-field-${v}`) })), src.field);
  const matchSel = selectEl(['contains', 'startsWith', 'exact'].map(v => ({ value: v, label: t(`rule-match-${v}`) })), src.match);
  const typeSel = selectEl(['any', 'expense', 'income'].map(v => ({ value: v, label: t(v === 'any' ? 'rule-type-any' : `type-${v}`) })), src.type);
  const category = selectEl(ruleCategoryOptions(src.type), src.categoryId || '');
  const account = selectEl(accountOptions({ emptyLabel: t('rule-account-keep') }), src.accountId || '');
  const title = h('input', { type: 'text', value: src.title, autocomplete: 'off', placeholder: t('rule-title-placeholder') });
  const min = moneyInput({ value: src.minAmount, placeholder: t('rule-amount-any') });
  const max = moneyInput({ value: src.maxAmount, placeholder: t('rule-amount-any') });
  const active = h('input', { type: 'checkbox', checked: src.active !== false });
  typeSel.addEventListener('change', () => fillSelect(category, ruleCategoryOptions(typeSel.value), category.value));

  const fail = (message) => { showToast(message, { type: 'error' }); return false; };
  const readLimit = (input) => {
    if (!input.value.trim()) return { ok: true, value: null };
    const v = input.readCents();
    return v === null || v < 0 ? { ok: false } : { ok: true, value: v };
  };

  const actions = [];
  if (rule) {
    actions.push({
      label: t('delete'), kind: 'danger', onClick: (m) => {
        withUndo(t('toast-rule-deleted'), () => store.remove('rules', rule.id));
        m.close();
      }
    });
  }
  actions.push({ label: t('cancel'), onClick: (m) => m.close() });
  actions.push({
    label: t('save'), kind: 'primary', onClick: (m) => {
      if (!text.value.trim()) return fail(t('err-rule-text'));
      if (!category.value) return fail(t('err-rule-category'));
      const lo = readLimit(min);
      const hi = readLimit(max);
      if (!lo.ok || !hi.ok) return fail(t('err-amount'));
      if (lo.value !== null && hi.value !== null && lo.value > hi.value) return fail(t('err-rule-limits'));
      const fields = {
        text: text.value.trim(), field: fieldSel.value, match: matchSel.value, type: typeSel.value,
        minAmount: lo.value, maxAmount: hi.value, categoryId: category.value,
        accountId: account.value || null, title: title.value.trim(), active: active.checked
      };
      if (rule) {
        store.update('rules', rule.id, fields);
      } else {
        const added = store.add('rules', makeRule({ ...fields, order: nextOrder() }));
        showToast(t('toast-rule-added'), { type: 'success', actionLabel: t('undo'), onAction: () => store.remove('rules', added.id) });
      }
      m.close();
      return true;
    }
  });

  return openModal({
    title: rule ? t('rule-edit') : t('rule-new'),
    className: 'rule-modal',
    body: h('div', { class: 'form-stack' },
      field(t('rule-text'), text, t('rule-text-hint')),
      h('div', { class: 'form-row' }, field(t('rule-field'), fieldSel), field(t('rule-match'), matchSel)),
      h('div', { class: 'form-row' }, field(t('rule-type'), typeSel), field(t('field-category'), category)),
      h('div', { class: 'form-row' }, field(t('rule-min'), min), field(t('rule-max'), max)),
      field(t('rule-title'), title, t('rule-title-hint')),
      field(t('rule-account'), account, t('rule-account-hint')),
      h('label', { class: 'checkbox-row' }, active, h('span', {}, t('rule-active')))),
    actions
  });
}

// Moves a rule one place up or down; the order is renumbered in one change
// so that two rules never share a place.
function move(ruleId, step) {
  const list = sortRules(store.data.rules);
  const i = list.findIndex(r => r.id === ruleId);
  const j = i + step;
  if (i === -1 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  store.commit(data => {
    const now = nowIso();
    list.forEach((r, k) => {
      const rec = data.rules.find(x => x.id === r.id);
      if (rec && rec.order !== k + 1) Object.assign(rec, { order: k + 1, updatedAt: now });
    });
  });
}

function tryBox() {
  const input = h('input', { type: 'text', autocomplete: 'off', placeholder: t('rule-try-placeholder'), 'aria-label': t('rule-try') });
  const result = h('div', { class: 'rule-try-result muted' });
  const update = () => {
    const value = input.value.trim();
    if (!value) { result.textContent = ''; return; }
    const list = sortRules(store.data.rules);
    const rule = applyRules(list, { text: value, note: value });
    result.className = `rule-try-result ${rule ? 'positive' : 'muted'}`;
    result.textContent = rule
      ? t('rule-try-match', { n: list.indexOf(rule) + 1, text: rule.text, category: categoryName(rule.categoryId) || t('no-category') })
      : t('rule-try-none');
  };
  input.addEventListener('input', update);
  return h('div', { class: 'rule-try' }, h('label', {}, t('rule-try')), input, result);
}

// The Settings section with all rules.
export function rulesSection(section) {
  const list = sortRules(store.data.rules);
  const rows = list.map((r, i) => {
    const on = h('input', { type: 'checkbox', checked: r.active !== false, 'aria-label': t('rule-active') });
    on.addEventListener('change', () => store.update('rules', r.id, { active: on.checked }));
    const btn = (name, label, onClick, disabled = false, cls = '') => h('button', {
      type: 'button', class: `icon-btn ${cls}`.trim(), title: label, 'aria-label': label, disabled, onclick: onClick
    }, icon(name));
    return h('tr', { class: r.active === false ? 'is-archived' : '' },
      h('td', { class: 'rule-on' }, on),
      h('td', {},
        h('div', { class: 'row-title' }, `"${r.text}"`, r.title ? h('span', { class: 'muted' }, ` ${flowArrow()} ${r.title}`) : null),
        h('div', { class: 'row-meta' }, ruleSummary(r))),
      h('td', {}, r.type === 'any' ? t('rule-type-any') : t(`type-${r.type}`)),
      h('td', {}, categoryName(r.categoryId) || h('span', { class: 'muted' }, t('no-category'))),
      h('td', {}, r.accountId ? accountLabel(r.accountId) : ''),
      h('td', { class: 'col-actions' },
        btn('arrow-up', t('rule-up'), () => move(r.id, -1), i === 0),
        btn('arrow-down', t('rule-down'), () => move(r.id, 1), i === list.length - 1),
        btn('pencil', t('edit'), () => openRuleModal(r)),
        btn('trash-2', t('delete'), () => withUndo(t('toast-rule-deleted'), () => store.remove('rules', r.id)), false, 'danger')));
  });
  return section(t('rules-title'), 'wand-2',
    h('p', { class: 'setting-hint' }, t('rules-hint')),
    rows.length
      ? h('div', { class: 'table-scroll' }, h('table', { class: 'cat-table rules-table' },
        h('thead', {}, h('tr', {},
          h('th', {}), h('th', {}, t('rule-text')), h('th', {}, t('rule-type')), h('th', {}, t('field-category')),
          h('th', {}, t('field-account')), h('th', {}))),
        h('tbody', {}, rows)))
      : h('p', { class: 'muted small' }, t('rules-empty')),
    h('div', { class: 'inline-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openRuleModal() }, icon('plus'), t('rule-new'))),
    list.length ? tryBox() : null);
}

// 'Always for "<text>"': a rule from a bank row whose category the person
// just chose. Returns the new rule.
export function ruleFromRow({ description, type, categoryId }) {
  const text = suggestRuleText(description);
  if (!text || !categoryId) return null;
  const rule = store.add('rules', makeRule({
    text, field: 'any', match: 'contains', type, categoryId,
    title: cleanTitle(text), order: firstOrder()
  }));
  showToast(t('toast-rule-for', { text }), { type: 'success', actionLabel: t('undo'), onAction: () => store.remove('rules', rule.id) });
  return rule;
}
