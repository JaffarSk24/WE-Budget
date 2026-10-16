// Bank statement import (desktop): choose the account and a CSV file, check
// the columns, review what every bank row will do, apply in one change.
// Reading the file is in src/import/bank.js, matching in src/import/match.js;
// the bank balance at the end is checked in the one reconciliation dialog
// (src/balances.js), never here.

import { store } from './store.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';
import { h, clear, icon, money, openModal, selectEl, categoryOptions, refreshIcons, badge, lang } from './ui.js';
import { live, nowIso } from './model.js';
import { formatDay, formatDate, todayKey } from './dates.js';
import { accountSummaries } from './ledger.js';
import {
  decodeStatement, readStatement, mappingComplete, mappingFromNames, mappingToNames, withImportKeys,
  lastBalance, MAPPING_FIELDS
} from './import/bank.js';
import { matchStatement, countActions, buildImportChanges } from './import/match.js';
import { applyRules, suggestRuleText } from './rules.js';
import { openBalancesModal } from './balances.js';
import { ruleFromRow } from './views/rules.js';

const PREVIEW_ROWS = 6;
const ACTIONS = ['match', 'new', 'recorded', 'skip'];

function topAccounts() {
  const accounts = live(store.data.accounts).filter(a => !a.archived);
  return accounts
    .filter(a => !a.parentId || !accounts.some(p => p.id === a.parentId))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

function button(label, kind, onClick, { disabled = false, iconName = null } = {}) {
  const btn = h('button', {
    type: 'button', class: `btn ${kind === 'primary' ? 'btn-primary' : 'btn-secondary'}`, disabled, onclick: onClick
  }, iconName ? icon(iconName) : null, label);
  if (kind === 'primary') btn.dataset.primary = '1';
  return btn;
}

export function openStatementImport({ accountId = null } = {}) {
  const tops = topAccounts();
  if (!tops.length) {
    showToast(t('err-no-accounts'), { type: 'error' });
    return null;
  }
  const own = accountId && store.find('accounts', accountId);
  // An envelope's statement is its bank account's statement.
  const start = own ? (own.parentId && tops.some(a => a.id === own.parentId) ? own.parentId : own.id) : tops[0].id;
  const state = {
    accountId: tops.some(a => a.id === start) ? start : tops[0].id,
    file: null, text: '', encoding: 'utf-8', read: null, mapping: null, dateOrder: null, proposals: null, rows: null
  };
  const body = h('div', { class: 'form-stack import-body' });
  const modal = openModal({
    title: t('import-title'),
    wide: true,
    className: 'import-modal',
    body,
    // The footer is filled by each step.
    actions: [{ label: t('cancel'), onClick: (m) => m.close() }]
  });

  const footer = (...buttons) => {
    modal.footer.replaceChildren(...buttons.filter(Boolean));
  };
  const show = (...children) => {
    clear(body);
    body.append(...children.flat().filter(Boolean));
    refreshIcons();
    body.scrollTop = 0;
  };

  // ---------- step 1: account and file ----------

  function stepFile() {
    const account = selectEl(tops.map(a => ({ value: a.id, label: a.name })), state.accountId);
    account.addEventListener('change', () => { state.accountId = account.value; });
    const input = h('input', { type: 'file', accept: '.csv,.txt,text/csv', class: 'visually-hidden', tabindex: '-1' });
    const name = h('span', { class: 'import-file-name muted' }, state.file ? state.file.name : t('import-no-file'));
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        state.file = { name: file.name };
        const decoded = decodeStatement(bytes);
        state.text = decoded.text;
        state.encoding = decoded.encoding;
        loadMapping();
        stepMapping();
      } catch (e) {
        console.error(e);
        showToast(t('err-file'), { type: 'error' });
      }
    });
    show(
      h('p', { class: 'field-hint' }, t('import-intro')),
      h('div', { class: 'form-group' }, h('label', {}, t('field-account')), account,
        h('div', { class: 'field-hint' }, t('import-account-hint'))),
      h('div', { class: 'form-group' }, h('label', {}, t('import-file')),
        h('div', { class: 'import-file' },
          button(t('import-choose-file'), 'secondary', () => input.click(), { iconName: 'file-input' }), name, input),
        h('div', { class: 'field-hint' }, t('import-file-hint'))));
    footer(
      button(t('cancel'), 'secondary', () => modal.close()),
      button(t('import-next'), 'primary', () => (state.text ? (loadMapping(), stepMapping()) : input.click())));
  }

  // The saved mapping of this account when it fits the file, otherwise
  // what the header names suggest.
  function loadMapping() {
    const first = readStatement(state.text);
    const saved = (store.settings.importMappings || {})[state.accountId];
    const fromSaved = saved ? mappingFromNames(first.header, saved) : null;
    state.mapping = fromSaved || first.mapping;
    state.dateOrder = fromSaved && saved.dateOrder ? saved.dateOrder : null;
    state.savedUsed = !!fromSaved;
    state.preset = first.preset;
    refresh();
  }

  function refresh() {
    state.read = readStatement(state.text, { mapping: state.mapping, dateOrder: state.dateOrder });
    if (!state.dateOrder) state.dateOrder = state.read.dateOrder;
  }

  // ---------- step 2: columns ----------

  function stepMapping() {
    const r = state.read;
    const header = r.header;
    const columnOptions = [{ value: '-1', label: t('import-col-none') }]
      .concat(header.map((name, i) => ({ value: String(i), label: name || t('import-col-n', { n: i + 1 }) })));
    const preview = h('div', { class: 'import-preview' });
    const info = h('div', { class: 'import-info' });

    const renderPreview = () => {
      const read = state.read;
      clear(info);
      clear(preview);
      const preset = state.savedUsed ? 'saved' : state.preset;
      // append() would print a literal "null": empty parts are dropped first.
      info.append(...[
        h('p', {}, icon('info'), h('span', {}, t(`import-preset-${preset}`))),
        state.encoding !== 'utf-8' ? h('p', { class: 'field-hint' }, t('import-encoding', { encoding: state.encoding })) : null,
        h('p', { class: 'field-hint' }, [
          t('import-rows-found', { n: read.rows.length }),
          read.invalid ? t('import-rows-invalid', { n: read.invalid }) : null,
          read.pending ? t('import-rows-pending', { n: read.pending }) : null
        ].filter(Boolean).join(' · '))
      ].filter(Boolean));
      if (!mappingComplete(state.mapping)) {
        preview.append(h('p', { class: 'banner banner-warning' }, icon('alert-triangle'), h('span', {}, t('import-need-columns'))));
      } else if (!read.rows.length) {
        preview.append(h('p', { class: 'banner banner-warning' }, icon('alert-triangle'), h('span', {}, t('import-no-rows'))));
      } else {
        preview.append(h('div', { class: 'import-preview-title' }, t('import-preview')),
          h('div', { class: 'import-list' }, read.rows.slice(0, PREVIEW_ROWS).map(row => h('div', { class: 'import-preview-row' },
            h('span', { class: 'import-date' }, `${formatDay(row.date, lang())}.${row.date.slice(0, 4)}`),
            h('span', { class: 'import-desc' }, row.description || h('span', { class: 'muted' }, t('untitled')),
              row.counterparty || row.note ? h('span', { class: 'row-meta' }, [row.counterparty, row.note].filter(Boolean).join(' · ')) : null),
            h('span', { class: `import-amount money ${row.amount > 0 ? 'positive' : ''}` }, money(row.amount, { signed: row.amount > 0 })),
            h('span', { class: 'import-balance money muted' }, row.balance !== null ? money(row.balance) : '')))));
      }
      refreshIcons();
      next.disabled = !mappingComplete(state.mapping) || !read.rows.length;
    };

    const selects = MAPPING_FIELDS.map(f => {
      const sel = selectEl(columnOptions, String(state.mapping[f] ?? -1));
      sel.addEventListener('change', () => {
        state.mapping = { ...state.mapping, [f]: Number(sel.value) };
        // A single amount column and separate debit / credit columns
        // exclude each other.
        if (f === 'amount' && state.mapping.amount !== -1) state.mapping = { ...state.mapping, debit: -1, credit: -1 };
        if ((f === 'debit' || f === 'credit') && state.mapping[f] !== -1) state.mapping = { ...state.mapping, amount: -1 };
        state.savedUsed = false;
        state.preset = 'custom';
        refresh();
        syncSelects();
        renderPreview();
      });
      return { f, sel, el: h('div', { class: 'form-group' }, h('label', {}, t(`import-col-${f}`)), sel) };
    });
    const syncSelects = () => selects.forEach(({ f, sel }) => { sel.value = String(state.mapping[f] ?? -1); });

    const orderSel = selectEl([
      { value: 'dmy', label: t('import-date-dmy') },
      { value: 'mdy', label: t('import-date-mdy') }
    ], state.dateOrder || 'dmy');
    orderSel.addEventListener('change', () => {
      state.dateOrder = orderSel.value;
      refresh();
      renderPreview();
    });

    const next = button(t('import-next'), 'primary', () => {
      if (!mappingComplete(state.mapping) || !state.read.rows.length) return;
      prepareReview();
      stepReview();
    });

    show(
      info,
      r.dateAmbiguous ? h('div', { class: 'form-group import-date-order' },
        h('label', {}, t('import-date-order')), orderSel, h('div', { class: 'field-hint' }, t('import-date-order-hint'))) : null,
      h('details', { class: 'import-columns', open: !mappingComplete(state.mapping) || state.preset === 'custom' },
        h('summary', {}, t('import-columns')),
        h('div', { class: 'import-mapping' }, selects.map(s => s.el))),
      preview);
    footer(button(t('back'), 'secondary', stepFile), next);
    renderPreview();
  }

  // ---------- step 3: review ----------

  function prepareReview() {
    state.rows = withImportKeys(state.accountId, state.read.rows);
    state.proposals = matchStatement(store.data, state.accountId, state.rows, todayKey());
    state.proposals.forEach(p => {
      p.ruleCategoryId = p.categoryId;
      p.ruleTitle = p.title;
      p.categoryTouched = false;
      if (p.action === 'match') p.categoryId = (store.find('entries', p.entryId) || {}).categoryId || null;
    });
  }

  function entryLabel(id) {
    const e = store.find('entries', id);
    if (!e) return '';
    return t('import-plan-option', { title: e.title || t('untitled'), date: formatDay(e.date, lang()), amount: money(e.amount) });
  }

  function stepReview() {
    const totals = h('div', { class: 'import-totals' });
    const list = h('div', { class: 'import-list import-review' });
    const apply = button(t('import-apply'), 'primary', () => applyImport());

    const renderTotals = () => {
      const counts = countActions(state.proposals);
      const sums = { match: 0, new: 0, recorded: 0, skip: 0 };
      state.proposals.forEach(p => { sums[p.action] += p.row.amount; });
      clear(totals);
      ACTIONS.forEach(a => totals.append(h('div', { class: `import-total import-total-${a}` },
        h('span', { class: 'import-total-label' }, t(`import-action-${a}`)),
        h('strong', {}, String(counts[a])),
        counts[a] ? h('span', { class: 'money muted' }, money(sums[a], { signed: sums[a] > 0 })) : null)));
      apply.disabled = !counts.match && !counts.new;
      apply.textContent = t('import-apply-n', { n: counts.match + counts.new });
    };

    const renderRow = (p, i) => {
      const row = p.row;
      const entry = p.action === 'match' || p.action === 'recorded' ? store.find('entries', p.entryId) : null;
      const actionOptions = [];
      if (p.action === 'recorded' || p.recordedId) {
        p.recordedId = p.recordedId || p.entryId;
        actionOptions.push({ value: 'recorded', label: t('import-opt-recorded') });
      }
      p.options.forEach(id => actionOptions.push({ value: `match:${id}`, label: entryLabel(id) }));
      actionOptions.push({ value: 'new', label: t('import-opt-new') }, { value: 'skip', label: t('import-opt-skip') });
      const current = p.action === 'match' ? `match:${p.entryId}` : p.action;
      const actionSel = selectEl(actionOptions, current, { 'aria-label': t('import-action') });
      const isTransfer = entry && entry.type === 'transfer' && p.action === 'match';
      const categorySel = selectEl(categoryOptions(row.type, { emptyLabel: t('no-category') }), p.categoryId || '', { 'aria-label': t('field-category') });
      categorySel.disabled = p.action === 'skip' || p.action === 'recorded' || isTransfer;
      const ruleSlot = h('div', { class: 'import-rule-slot' });

      const showRuleOffer = () => {
        clear(ruleSlot);
        const text = suggestRuleText(row.description);
        if (!p.categoryTouched || !p.categoryId || !text || p.ruleCreated) return;
        ruleSlot.append(h('button', {
          type: 'button', class: 'link-btn', onclick: () => {
            const rule = ruleFromRow({ description: row.description, type: row.type, categoryId: p.categoryId });
            if (!rule) return;
            p.ruleCreated = true;
            // Other new rows the person has not touched follow the new rule.
            state.proposals.forEach(o => {
              if (o === p || o.categoryTouched || o.action !== 'new') return;
              const hit = applyRules(live(store.data.rules), { text: o.row.description, note: [o.row.counterparty, o.row.note].filter(Boolean).join(' '), type: o.row.type, amount: Math.abs(o.row.amount) });
              if (hit && hit.id === rule.id) {
                o.categoryId = rule.categoryId;
                o.ruleCategoryId = rule.categoryId;
                if (rule.title) o.title = rule.title;
                if (o.title === o.ruleTitle && rule.title) o.ruleTitle = rule.title;
                o.ruleCreated = true;
              }
            });
            renderList();
          }
        }, icon('wand-2'), t('import-always', { text })));
        refreshIcons();
      };

      actionSel.addEventListener('change', () => {
        const value = actionSel.value;
        if (value.startsWith('match:')) {
          const id = value.slice(6);
          // One planned entry pays for one bank row: the row that had it
          // becomes new.
          state.proposals.forEach(o => {
            if (o !== p && o.action === 'match' && o.entryId === id) {
              o.action = 'new';
              o.entryId = null;
              if (!o.categoryTouched) o.categoryId = o.ruleCategoryId;
            }
          });
          p.action = 'match';
          p.entryId = id;
          if (!p.categoryTouched) p.categoryId = (store.find('entries', id) || {}).categoryId || null;
        } else {
          p.action = value;
          p.entryId = value === 'recorded' ? p.recordedId : null;
          if (value === 'new' && !p.categoryTouched) p.categoryId = p.ruleCategoryId;
        }
        renderList();
      });
      categorySel.addEventListener('change', () => {
        p.categoryId = categorySel.value || null;
        p.categoryTouched = true;
        showRuleOffer();
      });
      showRuleOffer();

      const reasons = [];
      if (p.action === 'match' && entry) reasons.push(t('import-why-match', { title: entry.title || t('untitled'), date: formatDay(entry.date, lang()) }));
      if (p.action === 'recorded' && entry) reasons.push(t('import-why-recorded', { title: entry.title || t('untitled'), date: formatDay(entry.date, lang()) }));
      if (p.beforeStart) reasons.push(t('import-why-before-start'));
      if (p.future) reasons.push(t('import-why-future'));
      const title = p.action === 'new' && p.title !== row.description ? p.title : null;

      return h('div', { class: `import-row import-row-${p.action}`, dataset: { index: String(i) } },
        h('div', { class: 'import-row-main' },
          h('span', { class: 'import-date' }, formatDay(row.date, lang())),
          h('span', { class: 'import-desc' },
            h('span', { class: 'import-desc-text' }, row.description || t('untitled')),
            title ? h('span', { class: 'row-meta' }, '→ ', title) : null,
            p.note ? h('span', { class: 'row-meta' }, p.note) : null,
            reasons.length ? h('span', { class: 'row-meta import-why' }, reasons.join(' · ')) : null),
          h('span', { class: `import-amount money ${row.amount > 0 ? 'positive' : ''}` }, money(row.amount, { signed: row.amount > 0 }))),
        h('div', { class: 'import-row-controls' },
          badge(t(`import-action-${p.action}`), `badge-import-${p.action}`),
          actionSel, categorySel),
        ruleSlot);
    };

    const renderList = () => {
      clear(list);
      list.append(...state.proposals.map(renderRow));
      renderTotals();
      refreshIcons();
    };

    const account = store.find('accounts', state.accountId);
    show(
      h('p', { class: 'field-hint' }, t('import-review-hint', { name: account ? account.name : '' })),
      totals,
      list);
    footer(button(t('back'), 'secondary', stepMapping), apply);
    renderList();
  }

  // ---------- applying ----------

  function applyImport() {
    const proposals = state.proposals;
    const counts = countActions(proposals);
    if (!counts.match && !counts.new) return;
    const snap = store.snapshot();
    const accountId = state.accountId;
    const saved = { columns: mappingToNames(state.read.header, state.mapping), dateOrder: state.dateOrder };
    store.commit(data => {
      const now = nowIso();
      const { newEntries, updates } = buildImportChanges(data, proposals, now);
      data.entries.push(...newEntries);
      updates.forEach(u => {
        const e = data.entries.find(x => x.id === u.id);
        if (e) Object.assign(e, u.patch, { updatedAt: now });
      });
      data.settings.importMappings = { ...(data.settings.importMappings || {}), [accountId]: saved };
      data.settings.updatedAt = now;
    });
    // Planned payments marked done can move saving-ahead goals on.
    store.followSaveAhead();
    showToast(t('toast-imported', { matched: counts.match, added: counts.new }), {
      type: 'success', duration: 10000, actionLabel: t('undo'), onAction: () => store.restore(snap)
    });
    const bank = lastBalance(state.rows);
    if (!bank) {
      modal.close();
      return;
    }
    stepBalance(bank);
  }

  // ---------- step 4: the bank's balance ----------

  function stepBalance(bank) {
    const s = accountSummaries(store.data, bank.date).get(state.accountId);
    const app = s ? s.totalBalance : 0;
    const diff = bank.balance - app;
    const hasEnvelopes = live(store.data.accounts).some(a => a.parentId === state.accountId);
    show(
      h('div', { class: 'banner banner-success' }, icon('check-circle-2'), h('span', {}, t('import-done'))),
      h('div', { class: 'import-balance-grid' },
        h('div', {}, h('div', { class: 'muted small' }, t('import-bank-balance', { date: formatDate(bank.date, lang()) })), h('strong', { class: 'money' }, money(bank.balance))),
        h('div', {}, h('div', { class: 'muted small' }, t(hasEnvelopes ? 'import-app-balance-group' : 'import-app-balance')), h('strong', { class: 'money' }, money(app))),
        h('div', {}, h('div', { class: 'muted small' }, t('balances-col-diff')),
          h('strong', { class: `money ${diff ? (diff > 0 ? 'positive' : 'negative') : ''}` }, diff ? money(diff, { signed: true }) : t('balances-match')))),
      h('p', { class: 'field-hint' }, t(diff ? 'import-balance-differs' : 'import-balance-same')));
    footer(
      button(t('close'), 'secondary', () => modal.close()),
      button(t('balances-open'), diff ? 'primary' : 'secondary', () => {
        modal.close();
        openBalancesModal({ focusAccountId: state.accountId });
      }, { iconName: 'scale' }));
  }

  stepFile();
  return modal;
}

