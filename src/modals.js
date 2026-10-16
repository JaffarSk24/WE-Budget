// Dialogs: entry, quick entry, allocation, reconciliation, account,
// template, actual amount prompt.

import { store } from './store.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';
import {
  h, clear, field, selectEl, moneyInput, openModal, money, accountOptions, accountLabel,
  categoryOptions, icon, refreshIcons, confirmDialog, lang
} from './ui.js';
import { makeAccount, makeEntry, makeTemplate, nowIso, live } from './model.js';
import { todayKey, isDayKey, formatDay, monthOf, addDays } from './dates.js';
import { accountSummaries, canSaveAhead, categorySpentInMonth, effectiveLimit, saveAheadGoal } from './ledger.js';
import { openSaveAheadModal, stopSaveAhead } from './views/save-ahead.js';
import { applyRules } from './rules.js';
import { allocationCandidates, defaultAllocationEnd, planForSelection, suggestAllocation } from './allocation.js';
import { splitEditor } from './split-editor.js';
import { tagPicker } from './tag-ui.js';

const LAST_QUICK_ACCOUNT = 'we-budget-last-quick-account';
const LAST_QUICK_CATEGORY = 'we-budget-last-quick-category';
const LAST_QUICK_INCOME_ACCOUNT = 'we-budget-last-quick-income-account';
const LAST_QUICK_INCOME_CATEGORY = 'we-budget-last-quick-income-category';

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* not essential */ }
}

function recall(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function dateInput(value) {
  return h('input', { type: 'date', value: value || todayKey() });
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
  options.forEach(o => {
    const btn = h('button', {
      type: 'button', class: `segmented-item ${o.value === value ? 'active' : ''}`,
      role: 'radio', 'aria-checked': o.value === value ? 'true' : 'false',
      onclick: () => {
        wrap.querySelectorAll('.segmented-item').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        wrap.dataset.value = o.value;
        onChange(o.value);
      }
    }, o.label);
    wrap.appendChild(btn);
  });
  wrap.dataset.value = value;
  return wrap;
}

function checkbox(label, checked) {
  const input = h('input', { type: 'checkbox', checked });
  return { input, el: h('label', { class: 'checkbox-row' }, input, h('span', {}, label)) };
}

function fail(message) {
  showToast(message, { type: 'error' });
  return false;
}

export function withUndo(message, action) {
  const snap = store.snapshot();
  const result = action();
  showToast(message, { type: 'success', actionLabel: t('undo'), onAction: () => store.restore(snap) });
  return result;
}

// ---------- entry ----------

export function openEntryModal(entry = null, defaults = {}) {
  const isNew = !entry;
  const src = entry || {
    type: defaults.type || 'expense',
    date: defaults.date || todayKey(),
    status: 'planned',
    accountId: defaults.accountId || null
  };
  let type = src.type;

  const title = h('input', { type: 'text', value: src.title || '', placeholder: t('entry-title-placeholder') });
  const amount = moneyInput({ value: isNew ? null : src.amount });
  const date = dateInput(src.date);
  const account = selectEl(accountOptions({ emptyLabel: t('choose-account') }), src.accountId || store.settings.defaultIncomeAccountId || '');
  const toAccount = selectEl(accountOptions({ emptyLabel: t('choose-account') }), src.toAccountId || '');
  const category = h('select');
  const status = selectEl([
    { value: 'planned', label: t('status-planned') },
    { value: 'reserved', label: t('status-reserved') },
    { value: 'done', label: t('status-done') },
    { value: 'cancelled', label: t('status-cancelled') }
  ], src.status);
  const transit = checkbox(t('entry-transit'), src.isTransit);
  const note = h('textarea', { rows: 2, placeholder: t('note-placeholder') }, src.note || '');

  const accountField = field(t('field-account'), account);
  const toField = field(t('field-to-account'), toAccount);
  const categoryField = field(t('field-category'), category);
  // Which loan or debt the payment goes to; shown only once there are debts.
  const debts = live(store.data.debts).filter(d => !d.archived || d.id === src.debtId);
  const debt = debts.length ? selectEl([{ value: '', label: t('entry-no-debt') }].concat(debts.map(d => ({ value: d.id, label: d.name }))), src.debtId || '') : null;
  const debtField = debt ? field(t('entry-debt'), debt) : null;
  const split = splitEditor({ entry, type, amount, category, categoryField });
  categoryField.appendChild(split.button);
  const tags = tagPicker(src.tagIds || defaults.tagIds || []);

  function syncType() {
    const opts = type === 'transfer' ? [] : categoryOptions(type, { emptyLabel: t('no-category') });
    clear(category);
    opts.forEach(o => category.appendChild(h('option', { value: o.value }, o.label)));
    category.value = src.type === type ? (src.categoryId || '') : '';
    split.reset(type);
    toField.style.display = type === 'transfer' ? '' : 'none';
    categoryField.style.display = type === 'transfer' ? 'none' : '';
    if (debtField) debtField.style.display = type === 'transfer' ? 'none' : '';
    accountField.querySelector('label').textContent = type === 'transfer' ? t('field-from-account') : t('field-account');
    status.querySelector('option[value="reserved"]').disabled = type !== 'expense';
    if (type !== 'expense' && status.value === 'reserved') status.value = 'planned';
  }

  const typeSwitch = segmented([
    { value: 'expense', label: t('type-expense') },
    { value: 'income', label: t('type-income') },
    { value: 'transfer', label: t('type-transfer') }
  ], type, (v) => { type = v; syncType(); });

  const template = entry && entry.templateId ? store.find('templates', entry.templateId) : null;
  const body = h('div', { class: 'form-stack' },
    typeSwitch,
    h('div', { class: 'form-row' }, field(t('field-date'), date), field(t('field-amount'), amount)),
    field(t('field-title'), title),
    h('div', { class: 'form-row' }, accountField, toField, categoryField),
    debtField,
    split.panel,
    field(t('field-status'), status),
    transit.el,
    field(t('field-note'), note),
    field(t('field-tags'), tags.el),
    template ? h('p', { class: 'field-hint' }, icon('repeat'), ' ', t('entry-from-template', { name: template.title })) : null,
    entry && entry.isAdjustment ? h('p', { class: 'field-hint' }, t('entry-is-adjustment')) : null
  );
  syncType();
  if (isNew) setTimeout(() => amount.focus(), 40);

  const actions = [];
  if (!isNew) {
    actions.push({
      label: t('delete'), kind: 'danger', onClick: (m) => {
        withUndo(t('toast-entry-deleted'), () => store.remove('entries', entry.id));
        m.close();
      }
    });
  }
  actions.push({ label: t('cancel'), onClick: (m) => m.close() });
  actions.push({
    label: t('save'), kind: 'primary', onClick: (m) => {
      const cents = amount.readCents();
      if (!isDayKey(date.value)) return fail(t('err-date'));
      if (cents === null || cents < 0) return fail(t('err-amount'));
      if (!account.value) return fail(t('err-account'));
      if (type === 'transfer' && (!toAccount.value || toAccount.value === account.value)) return fail(t('err-to-account'));
      const parts = split.read();
      if (parts && parts.error) return fail(parts.error);
      const patch = {
        type,
        date: date.value,
        title: title.value.trim(),
        amount: cents,
        accountId: account.value,
        toAccountId: type === 'transfer' ? toAccount.value : null,
        categoryId: type === 'transfer' ? null : (parts ? parts.categoryId : (category.value || null)),
        splits: parts ? parts.splits : null,
        tagIds: tags.save(),
        status: status.value,
        isTransit: transit.input.checked,
        note: note.value.trim()
      };
      if (debt) patch.debtId = type === 'transfer' ? null : (debt.value || null);
      if (patch.status === 'done' && (!entry || entry.status !== 'done')) patch.doneAt = nowIso();
      if (patch.status === 'reserved' && (!entry || entry.status !== 'reserved')) patch.reservedAt = nowIso();
      if (patch.status === 'planned') { patch.doneAt = null; patch.reservedAt = null; patch.allocationId = null; }
      if (isNew) {
        store.add('entries', makeEntry({ ...patch, plannedAmount: cents }));
        showToast(t('toast-entry-added'), { type: 'success' });
      } else {
        store.update('entries', entry.id, patch);
      }
      m.close();
      return true;
    }
  });

  openModal({ title: isNew ? t('entry-new') : t('entry-edit'), body, actions });
}

// ---------- several entries at once ----------

export function openBulkDateModal(ids) {
  const entries = live(store.data.entries).filter(e => ids.includes(e.id));
  if (!entries.length) return;
  let mode = 'set';
  const date = dateInput(entries[0].date);
  const days = h('input', { type: 'number', value: 1, step: 1 });
  const dateField = field(t('bulk-date-new'), date);
  const daysField = field(t('bulk-date-days'), days, t('bulk-date-days-hint'));
  daysField.style.display = 'none';
  const switcher = segmented([
    { value: 'set', label: t('bulk-date-mode-set') },
    { value: 'shift', label: t('bulk-date-mode-shift') }
  ], mode, (v) => {
    mode = v;
    dateField.style.display = v === 'set' ? '' : 'none';
    daysField.style.display = v === 'shift' ? '' : 'none';
  });

  openModal({
    title: t('bulk-date-title', { n: entries.length }),
    body: h('div', { class: 'form-stack' }, switcher, dateField, daysField),
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: t('save'), kind: 'primary', onClick: (m) => {
          if (mode === 'set' && !isDayKey(date.value)) return fail(t('err-date'));
          const shift = Math.trunc(Number(days.value));
          if (mode === 'shift' && (!Number.isFinite(shift) || shift === 0)) return fail(t('err-days'));
          withUndo(t('toast-bulk-moved', { n: entries.length }), () =>
            store.bulkUpdate(entries.map(e => e.id), (e) => ({ date: mode === 'set' ? date.value : addDays(e.date, shift) })));
          m.close();
          return true;
        }
      }
    ]
  });
}

export function openBulkAccountModal(ids) {
  const entries = live(store.data.entries).filter(e => ids.includes(e.id) && e.type !== 'transfer');
  if (!entries.length) {
    showToast(t('bulk-account-none'), { type: 'info' });
    return;
  }
  const account = selectEl(accountOptions({ emptyLabel: t('choose-account') }), '');
  openModal({
    title: t('bulk-account-title', { n: entries.length }),
    body: h('div', { class: 'form-stack' },
      field(t('field-account'), account),
      entries.length < ids.length ? h('p', { class: 'field-hint' }, t('bulk-account-transfers')) : null),
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: t('save'), kind: 'primary', onClick: (m) => {
          if (!account.value) return fail(t('err-account'));
          withUndo(t('toast-bulk-account', { n: entries.length }), () =>
            store.bulkUpdate(entries.map(e => e.id), { accountId: account.value }));
          m.close();
          return true;
        }
      }
    ]
  });
}

// ---------- actual amount for estimated payments ----------

export function promptAmount(entry) {
  return new Promise(resolve => {
    let done = false;
    const input = moneyInput({ value: entry.amount, autofocus: true });
    openModal({
      title: t('actual-amount-title'),
      body: h('div', { class: 'form-stack' },
        h('p', {}, t('actual-amount-text', { name: entry.title || '', planned: money(entry.plannedAmount ?? entry.amount) })),
        field(t('field-amount'), input)),
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: t('cancel'), onClick: (m) => m.close() },
        {
          label: t('mark-done'), kind: 'primary', onClick: (m) => {
            const cents = input.readCents();
            if (cents === null || cents < 0) return fail(t('err-amount'));
            done = true;
            resolve(cents);
            m.close();
            return true;
          }
        }
      ]
    });
  });
}

// ---------- quick entry ----------

// A payment or an income that was not in the plan, written down in a few
// taps: it is done at once and never counted as planned.
// `amount` (cents), `note`, `categoryId` and `accountId` fill the dialog in,
// for a link from an iPhone Shortcut; without them it starts from the last
// category and account used.
export function openQuickEntry({ type: startType = 'expense', amount: startAmount = null, note: startNote = '', categoryId: startCategory = null, accountId: startAccount = null } = {}) {
  if (!store.list('accounts').length) {
    showToast(t('err-no-accounts'), { type: 'error' });
    return;
  }
  let type = startType === 'income' ? 'income' : 'expense';
  const categoryKey = () => (type === 'income' ? LAST_QUICK_INCOME_CATEGORY : LAST_QUICK_CATEGORY);
  const accountKey = () => (type === 'income' ? LAST_QUICK_INCOME_ACCOUNT : LAST_QUICK_ACCOUNT);
  const accountFor = () => recall(accountKey()) || store.settings.defaultIncomeAccountId || '';

  const amount = moneyInput({ autofocus: true, value: startAmount > 0 ? startAmount : null });
  amount.classList.add('quick-amount');
  const category = selectEl([], '');
  const account = selectEl(accountOptions(), (startAccount && store.find('accounts', startAccount) ? startAccount : null) || accountFor());
  const date = dateInput(todayKey());
  const note = h('input', { type: 'text', enterkeyhint: 'done', autocomplete: 'off', value: startNote || '' });
  // The category from a link wins only for the type it was given with.
  let linkCategory = startCategory ? { type, id: startCategory } : null;
  const limitHint = h('div', { class: 'field-hint' });
  const ruleHint = h('div', { class: 'field-hint rule-hint' });
  // Tags fold away under "More": most quick payments need none, and on a
  // phone the amount and the buttons keep the screen.
  const tags = tagPicker([]);
  const moreBox = h('div', { class: 'quick-more', hidden: true }, field(t('field-tags'), tags.el));
  const moreBtn = h('button', {
    type: 'button', class: 'link-btn quick-more-toggle', 'aria-expanded': 'false',
    onclick: () => {
      moreBox.hidden = !moreBox.hidden;
      moreBtn.setAttribute('aria-expanded', moreBox.hidden ? 'false' : 'true');
    }
  }, icon('tag'), t('quick-more'));
  // A category the person picked (or one that came with a link) is theirs;
  // until then the category follows the first rule that matches the note.
  let categoryTouched = !!linkCategory;
  let accountTouched = !!startAccount;
  let ruleDefault = null;

  function followRules() {
    if (categoryTouched) return;
    const text = note.value.trim();
    const cents = amount.readCents();
    const rule = text ? applyRules(store.list('rules'), { text, note: text, type, amount: cents }) : null;
    const known = rule && rule.categoryId && [...category.options].some(o => o.value === rule.categoryId);
    if (known) {
      if (ruleDefault === null) ruleDefault = { category: category.value, account: account.value };
      category.value = rule.categoryId;
      if (!accountTouched && rule.accountId && store.find('accounts', rule.accountId)) account.value = rule.accountId;
      ruleHint.textContent = t('quick-rule-applied', { text: rule.text });
    } else if (ruleDefault !== null) {
      // The note no longer matches: back to what was there before the rule.
      category.value = ruleDefault.category;
      if (!accountTouched) account.value = ruleDefault.account;
      ruleDefault = null;
      ruleHint.textContent = '';
    }
    updateLimit();
  }

  function fillCategories() {
    clear(category);
    const wanted = (linkCategory && linkCategory.type === type ? linkCategory.id : null) || recall(categoryKey()) || '';
    categoryOptions(type, { emptyLabel: t('no-category') }).forEach(o => {
      category.appendChild(h('option', { value: o.value, selected: o.value === wanted }, o.label));
    });
    note.placeholder = t(type === 'income' ? 'quick-note-placeholder-income' : 'quick-note-placeholder');
  }

  function updateLimit() {
    const cat = type === 'expense' ? store.find('categories', category.value) : null;
    if (!cat || !cat.monthlyLimit) { limitHint.textContent = ''; return; }
    const month = monthOf(date.value || todayKey());
    const spent = categorySpentInMonth(store.data, cat.id, month);
    // With rollover, this month's limit includes what carried over.
    const limit = effectiveLimit(store.data, cat.id, month);
    const left = limit - spent;
    limitHint.textContent = t('limit-left', { left: money(left), limit: money(limit) });
    limitHint.classList.toggle('negative', left < 0);
  }

  const typeSwitch = segmented([
    { value: 'expense', label: t('quick-type-expense') },
    { value: 'income', label: t('quick-type-income') }
  ], type, (value) => {
    type = value;
    fillCategories();
    account.value = accountFor() || account.value;
    ruleDefault = null;
    ruleHint.textContent = '';
    // The new type brings its own category list: a pick made for the other
    // type is gone, so the rules decide again.
    categoryTouched = !!(linkCategory && linkCategory.type === type);
    followRules();
    amount.focus();
  });
  typeSwitch.classList.add('quick-type');

  fillCategories();
  category.addEventListener('change', () => {
    categoryTouched = true;
    ruleDefault = null;
    ruleHint.textContent = '';
    updateLimit();
  });
  account.addEventListener('change', () => { accountTouched = true; });
  note.addEventListener('input', followRules);
  amount.addEventListener('input', () => { if (note.value.trim()) followRules(); });
  date.addEventListener('change', updateLimit);
  // A link from a Shortcut can bring the merchant as the note.
  followRules();

  function save(m, again) {
    const cents = amount.readCents();
    if (cents === null || cents <= 0) return fail(t('err-amount'));
    if (!isDayKey(date.value)) return fail(t('err-date'));
    remember(accountKey(), account.value);
    remember(categoryKey(), category.value);
    const added = store.addQuickEntry({
      type, amount: cents, categoryId: category.value || null, accountId: account.value,
      note: note.value.trim(), date: date.value, tagIds: tags.save()
    });
    showToast(t(type === 'income' ? 'toast-quick-income' : 'toast-quick-added', { amount: money(cents) }), {
      type: 'success', actionLabel: t('undo'), onAction: () => store.remove('entries', added.id)
    });
    if (again) {
      linkCategory = null;
      categoryTouched = false;
      ruleDefault = null;
      ruleHint.textContent = '';
      amount.value = '';
      note.value = '';
      amount.focus();
      updateLimit();
    } else {
      m.close();
    }
    return true;
  }

  openModal({
    title: t('quick-title'),
    body: h('div', { class: 'form-stack quick-form' },
      typeSwitch,
      field(t('field-amount'), amount),
      h('div', { class: 'form-row' }, field(t('field-category'), category), field(t('field-account'), account)),
      limitHint,
      h('div', { class: 'form-row' }, field(t('field-date'), date), field(t('field-note'), note)),
      ruleHint,
      moreBtn,
      moreBox
    ),
    actions: [
      { label: t('quick-save-more'), onClick: (m) => save(m, true) },
      { label: t('save'), kind: 'primary', onClick: (m) => save(m, false) }
    ]
  });
}

// ---------- allocation ----------

export function openAllocationModal({ sourceAccountId = null, until = null, preselect = null } = {}) {
  const today = todayKey();
  const source = selectEl(accountOptions(), sourceAccountId || store.settings.defaultIncomeAccountId || '');
  // Bills picked in the month view: cover exactly those, up to the last one.
  let picked = preselect && preselect.length ? new Set(preselect) : null;
  let untilDefault = until || defaultAllocationEnd(store.data, today);
  if (picked) {
    const last = live(store.data.entries).filter(e => picked.has(e.id)).map(e => e.date).sort().pop();
    if (last && last > untilDefault) untilDefault = last;
  }
  const untilInput = dateInput(untilDefault);
  const freeInfo = h('div', { class: 'alloc-free' });
  const list = h('div', { class: 'alloc-list' });
  const summary = h('div', { class: 'alloc-summary' });
  let selected = new Set();

  function resetSelection() {
    if (picked) {
      const ids = new Set(allocationCandidates(store.data, untilInput.value).map(e => e.id));
      selected = new Set([...picked].filter(id => ids.has(id)));
      picked = null;
      return;
    }
    const plan = suggestAllocation(store.data, source.value, untilInput.value);
    selected = new Set([...plan.inPlace, ...plan.lines.flatMap(l => l.entryIds)]);
  }

  function render() {
    const summaries = accountSummaries(store.data);
    const src = summaries.get(source.value);
    freeInfo.textContent = t('alloc-free-on-source', { amount: money(src ? src.ownFree : 0) });

    const candidates = allocationCandidates(store.data, untilInput.value);
    clear(list);
    if (!candidates.length) {
      list.appendChild(h('p', { class: 'muted' }, t('alloc-nothing')));
    }
    candidates.forEach(e => {
      const cb = h('input', { type: 'checkbox', checked: selected.has(e.id) });
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(e.id); else selected.delete(e.id);
        renderSummary();
      });
      const envFree = e.accountId !== source.value ? ((summaries.get(e.accountId)?.ownFree || 0) + (summaries.get(e.accountId)?.ownFrozen || 0)) : 0;
      list.appendChild(h('label', { class: `alloc-row ${e.date < today ? 'overdue' : ''}` },
        cb,
        h('span', { class: 'alloc-date' }, formatDay(e.date, lang())),
        h('span', { class: 'alloc-title' }, e.title || t('untitled')),
        h('span', { class: 'alloc-account' }, accountLabel(e.accountId)),
        h('span', { class: 'alloc-amount money' }, money(e.amount)),
        envFree > 0 ? h('span', { class: 'alloc-note' }, t('alloc-env-free', { amount: money(envFree) })) : null
      ));
    });
    renderSummary();
  }

  function renderSummary() {
    const plan = planForSelection(store.data, source.value, [...selected], untilInput.value);
    clear(summary);
    if (!plan.lines.length && !plan.inPlace.length) {
      summary.appendChild(h('p', { class: 'muted' }, t('alloc-pick')));
      return plan;
    }
    plan.lines.forEach(l => summary.appendChild(h('div', { class: 'alloc-line' },
      icon('arrow-right'), h('span', {}, accountLabel(l.toAccountId)), h('strong', { class: 'money' }, money(l.amount)))));
    if (plan.inPlace.length) {
      const inPlaceSum = live(store.data.entries).filter(e => plan.inPlace.includes(e.id)).reduce((s, e) => s + e.amount, 0);
      summary.appendChild(h('div', { class: 'alloc-line' }, icon('check'), h('span', {}, t('alloc-in-place')), h('strong', { class: 'money' }, money(inPlaceSum))));
    }
    summary.appendChild(plan.shortfall > 0
      ? h('div', { class: 'alloc-line negative' }, icon('alert-triangle'), h('span', {}, t('alloc-shortfall')), h('strong', { class: 'money' }, money(plan.shortfall)))
      : h('div', { class: 'alloc-line positive' }, icon('wallet'), h('span', {}, t('alloc-left-free')), h('strong', { class: 'money' }, money(plan.sourceFreeAfter))));
    refreshIcons();
    return plan;
  }

  source.addEventListener('change', () => { resetSelection(); render(); });
  untilInput.addEventListener('change', () => { if (isDayKey(untilInput.value)) { resetSelection(); render(); } });
  resetSelection();
  render();

  openModal({
    title: t('alloc-title'),
    wide: true,
    body: h('div', { class: 'form-stack' },
      h('p', { class: 'field-hint' }, t('alloc-explain')),
      h('div', { class: 'form-row' }, field(t('alloc-source'), source), field(t('alloc-until'), untilInput)),
      freeInfo,
      list,
      summary),
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: t('alloc-apply'), kind: 'primary', onClick: async (m) => {
          const plan = planForSelection(store.data, source.value, [...selected], untilInput.value);
          if (!plan.lines.length && !plan.inPlace.length) return fail(t('alloc-pick'));
          if (plan.shortfall > 0) {
            const ok = await confirmDialog(t('alloc-confirm-short', { amount: money(plan.shortfall) }), { okLabel: t('alloc-apply') });
            if (!ok) return false;
          }
          plan.lines.forEach(l => { l.title = t('alloc-transfer-title'); });
          const count = plan.inPlace.length + plan.lines.reduce((s, l) => s + l.entryIds.length, 0);
          withUndo(t('toast-allocated', { n: count }), () => store.applyAllocation(plan, today));
          m.close();
          return true;
        }
      }
    ]
  });
}

// ---------- account ----------

export function openAccountModal(account = null, { parentId = null } = {}) {
  const isNew = !account;
  const src = account || { parentId, kind: 'current', openingBalance: 0 };
  const accounts = store.list('accounts');
  const name = h('input', { type: 'text', value: src.name || '', placeholder: t('account-name-placeholder') });
  const parentOpts = [{ value: '', label: t('account-no-parent') }].concat(
    accounts.filter(a => !a.parentId && (!account || a.id !== account.id)).map(a => ({ value: a.id, label: a.name })));
  const parent = selectEl(parentOpts, src.parentId || '');
  const bank = h('input', { type: 'text', value: src.bank || '', placeholder: t('account-bank-placeholder') });
  const kind = selectEl([
    { value: 'current', label: t('kind-current') },
    { value: 'savings', label: t('kind-savings') },
    { value: 'credit', label: t('kind-credit') },
    { value: 'cash', label: t('kind-cash') }
  ], src.kind);
  // Where the account starts on the tracking start date. The balance of
  // today is not asked here: that is what checking against the bank does.
  const opening = moneyInput({ value: src.openingBalance || 0 });
  const archived = checkbox(t('account-archived'), src.archived);
  const note = h('input', { type: 'text', value: src.note || '' });
  const hasChildren = account && accounts.some(a => a.parentId === account.id);
  if (hasChildren) parent.disabled = true;

  const actions = [];
  if (!isNew) {
    actions.push({
      label: t('delete'), kind: 'danger', onClick: async (m) => {
        const used = live(store.data.entries).some(e => e.accountId === account.id || e.toAccountId === account.id)
          || live(store.data.templates).some(x => x.accountId === account.id || x.toAccountId === account.id);
        if (used || hasChildren) {
          showToast(used ? t('err-account-used') : t('err-account-has-envelopes'), { type: 'error', duration: 7000 });
          return false;
        }
        withUndo(t('toast-account-deleted'), () => store.remove('accounts', account.id));
        m.close();
        return true;
      }
    });
  }
  actions.push({ label: t('cancel'), onClick: (m) => m.close() });
  actions.push({
    label: t('save'), kind: 'primary', onClick: (m) => {
      if (!name.value.trim()) return fail(t('err-name'));
      const cents = opening.readCents();
      if (cents === null) return fail(t('err-amount'));
      const patch = {
        name: name.value.trim(),
        parentId: parent.value || null,
        bank: bank.value.trim(),
        kind: kind.value,
        openingBalance: cents,
        archived: archived.input.checked,
        note: note.value.trim()
      };
      if (isNew) {
        const created = store.add('accounts', makeAccount({ ...patch, order: accounts.length }));
        if (!store.settings.defaultIncomeAccountId) store.updateSettings({ defaultIncomeAccountId: created.id });
      } else {
        store.update('accounts', account.id, patch);
      }
      m.close();
      return true;
    }
  });

  openModal({
    title: isNew ? (parentId ? t('account-new-envelope') : t('account-new')) : t('account-edit'),
    body: h('div', { class: 'form-stack' },
      field(t('field-name'), name),
      h('div', { class: 'form-row' }, field(t('account-parent'), parent, t('account-parent-hint')), field(t('account-bank'), bank)),
      h('div', { class: 'form-row' }, field(t('account-kind'), kind),
        field(t('account-opening'), opening, t(isNew ? 'account-opening-hint-new' : 'account-opening-hint', {
          date: store.settings.trackingStart ? `${formatDay(store.settings.trackingStart, lang())}.${store.settings.trackingStart.slice(0, 4)}` : ''
        }))),
      field(t('field-note'), note),
      isNew ? null : archived.el),
    actions
  });
}

// ---------- template ----------

const WEEKDAY_KEYS = ['wd-mon', 'wd-tue', 'wd-wed', 'wd-thu', 'wd-fri', 'wd-sat', 'wd-sun'];

export function openTemplateModal(template = null) {
  const isNew = !template;
  const src = template || makeTemplate({ schedule: { freq: 'monthly', day: Number(todayKey().slice(8, 10)), startDate: todayKey() } });
  let type = src.type;

  const title = h('input', { type: 'text', value: src.title, placeholder: t('template-title-placeholder') });
  const amount = moneyInput({ value: isNew ? null : src.amount });
  const estimate = checkbox(t('template-estimate'), src.amountIsEstimate);
  const account = selectEl(accountOptions({ emptyLabel: t('choose-account') }), src.accountId || '');
  const toAccount = selectEl(accountOptions({ emptyLabel: t('choose-account') }), src.toAccountId || '');
  const category = h('select');
  const freq = selectEl([
    { value: 'monthly', label: t('freq-monthly') },
    { value: 'everyNMonths', label: t('freq-everyNMonths') },
    { value: 'yearly', label: t('freq-yearly') },
    { value: 'weekly', label: t('freq-weekly') },
    { value: 'once', label: t('freq-once') }
  ], src.schedule.freq);
  const day = h('input', { type: 'number', min: 1, max: 31, value: src.schedule.day });
  const interval = h('input', { type: 'number', min: 2, max: 24, value: Math.max(2, src.schedule.interval || 2) });
  const fillGaps = checkbox(t('template-fill-gaps'), src.schedule.fillGaps);
  const weekdays = WEEKDAY_KEYS.map((k, i) => checkbox(t(k), (src.schedule.weekdays || []).includes(i)));
  const startDate = dateInput(src.schedule.startDate || todayKey());
  const endDate = h('input', { type: 'date', value: src.schedule.endDate || '' });
  const transit = checkbox(t('entry-transit'), src.isTransit);
  const active = checkbox(t('template-active'), src.active);
  const applyFuture = checkbox(t('template-apply-future'), true);
  const aheadGoal = isNew ? null : saveAheadGoal(store.data, src.id);
  const saveAhead = checkbox(t('save-ahead-check'), !!aheadGoal);

  const toField = field(t('field-to-account'), toAccount);
  const categoryField = field(t('field-category'), category);
  const tags = tagPicker(src.tagIds || []);
  const dayField = field(t('template-day'), day, t('template-day-hint'));
  const intervalField = field(t('template-interval'), interval);
  const weekdaysField = field(t('template-weekdays'), h('div', { class: 'weekday-row' }, weekdays.map(w => w.el)));

  function syncType() {
    clear(category);
    if (type !== 'transfer') {
      categoryOptions(type, { emptyLabel: t('no-category') }).forEach(o => category.appendChild(h('option', { value: o.value }, o.label)));
      category.value = src.type === type ? (src.categoryId || '') : '';
    }
    toField.style.display = type === 'transfer' ? '' : 'none';
    categoryField.style.display = type === 'transfer' ? 'none' : '';
    syncSaveAhead();
  }
  function syncFreq() {
    const f = freq.value;
    dayField.style.display = (f === 'monthly' || f === 'everyNMonths' || f === 'yearly') ? '' : 'none';
    intervalField.style.display = f === 'everyNMonths' ? '' : 'none';
    fillGaps.el.style.display = f === 'everyNMonths' ? '' : 'none';
    weekdaysField.style.display = f === 'weekly' ? '' : 'none';
    syncSaveAhead();
  }
  // Saving ahead is for expenses that do not come every month.
  function syncSaveAhead() {
    const f = freq.value;
    saveAhead.el.style.display = type === 'expense' && (f === 'yearly' || f === 'everyNMonths') ? '' : 'none';
  }
  freq.addEventListener('change', syncFreq);

  const typeSwitch = segmented([
    { value: 'expense', label: t('type-expense') },
    { value: 'income', label: t('type-income') },
    { value: 'transfer', label: t('type-transfer') }
  ], type, (v) => { type = v; syncType(); });
  syncType();
  syncFreq();

  const actions = [];
  if (!isNew) {
    actions.push({
      label: t('delete'), kind: 'danger', onClick: async (m) => {
        const ok = await confirmDialog(t('template-delete-confirm', { name: template.title }), { danger: true, okLabel: t('delete') });
        if (!ok) return false;
        withUndo(t('toast-template-deleted'), () => store.removeTemplate(template.id, { removeFuture: true }));
        m.close();
        return true;
      }
    });
  }
  actions.push({ label: t('cancel'), onClick: (m) => m.close() });
  actions.push({
    label: t('save'), kind: 'primary', onClick: (m) => {
      const cents = amount.readCents();
      if (!title.value.trim()) return fail(t('err-name'));
      if (cents === null || cents < 0) return fail(t('err-amount'));
      if (!account.value) return fail(t('err-account'));
      if (type === 'transfer' && (!toAccount.value || toAccount.value === account.value)) return fail(t('err-to-account'));
      if (!isDayKey(startDate.value)) return fail(t('err-date'));
      if (endDate.value && !isDayKey(endDate.value)) return fail(t('err-date'));
      const schedule = {
        freq: freq.value,
        interval: freq.value === 'everyNMonths' ? Math.max(2, Number(interval.value) || 2) : 1,
        day: Math.min(31, Math.max(1, Number(day.value) || 1)),
        weekdays: weekdays.map((w, i) => (w.input.checked ? i : -1)).filter(i => i >= 0),
        fillGaps: freq.value === 'everyNMonths' && fillGaps.input.checked,
        startDate: startDate.value,
        endDate: endDate.value || null
      };
      if (freq.value === 'weekly' && !schedule.weekdays.length) return fail(t('err-weekdays'));
      const next = {
        ...src,
        title: title.value.trim(),
        type,
        amount: cents,
        amountIsEstimate: estimate.input.checked,
        accountId: account.value,
        toAccountId: type === 'transfer' ? toAccount.value : null,
        categoryId: type === 'transfer' ? null : (category.value || null),
        schedule,
        tagIds: tags.save(),
        isTransit: transit.input.checked,
        active: active.input.checked
      };
      const scheduleChanged = !isNew && JSON.stringify(template.schedule) !== JSON.stringify(schedule);
      const wasActive = !isNew && template.active;
      store.saveTemplate(next, {
        applyToFuture: isNew ? false : applyFuture.input.checked,
        // Switching a template off drops its future entries; switching it
        // back on regenerates them from today.
        scheduleChanged: scheduleChanged || (!isNew && wasActive !== next.active)
      });
      showToast(isNew ? t('toast-template-added') : t('toast-template-saved'), { type: 'success' });
      m.close();
      const saved = store.find('templates', next.id);
      const wantAhead = saveAhead.input.checked && canSaveAhead(saved) && saved.active;
      if (aheadGoal && !wantAhead) stopSaveAhead(aheadGoal);
      else if (!aheadGoal && wantAhead) openSaveAheadModal(saved);
      return true;
    }
  });

  openModal({
    title: isNew ? t('template-new') : t('template-edit'),
    wide: true,
    body: h('div', { class: 'form-stack' },
      typeSwitch,
      h('div', { class: 'form-row' }, field(t('field-title'), title), field(t('field-amount'), amount)),
      estimate.el,
      h('div', { class: 'form-row' }, field(type === 'transfer' ? t('field-from-account') : t('field-account'), account), toField, categoryField),
      h('div', { class: 'form-row' }, field(t('template-freq'), freq), dayField, intervalField),
      fillGaps.el,
      weekdaysField,
      h('div', { class: 'form-row' }, field(t('template-start'), startDate), field(t('template-end'), endDate, t('template-end-hint'))),
      field(t('field-tags'), tags.el, t('template-tags-hint')),
      h('div', { class: 'checkbox-group' }, transit.el, active.el, saveAhead.el, isNew ? null : applyFuture.el)),
    actions
  });
}
