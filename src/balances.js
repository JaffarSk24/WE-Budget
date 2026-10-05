// The reconciliation day: type what every account holds right now according
// to the bank, and balances, the month end and the forecast follow. Every
// difference becomes a visible adjustment dated that day; empty fields are
// left alone.
//
// Payments dated that day or earlier that are still open would be counted
// twice (once inside the bank balance, once more by the plan), so they are
// shown first, to be marked before saving.

import { store } from './store.js';
import { t, tn } from './i18n.js';
import { h, clear, icon, money, moneyInput, openModal, refreshIcons, badge } from './ui.js';
import { showToast } from './toast.js';
import { accountSummaries, entriesOn, overdueEntries } from './ledger.js';
import { live } from './model.js';
import { isDayKey, todayKey } from './dates.js';
import { entryListItem } from './actions.js';

function orderedAccounts() {
  const accounts = live(store.data.accounts).filter(a => !a.archived);
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
  const rows = [];
  accounts.filter(a => !a.parentId || !accounts.some(p => p.id === a.parentId)).sort(byOrder).forEach(top => {
    const children = accounts.filter(a => a.parentId === top.id).sort(byOrder);
    if (children.length) {
      rows.push({ kind: 'group', account: top });
      rows.push({ kind: 'own', account: top });
      children.forEach(c => rows.push({ kind: 'child', account: c }));
    } else {
      rows.push({ kind: 'single', account: top });
    }
  });
  return rows;
}

// One dialog for one account or all of them: the icon on an account row
// opens it on that account, the button in the header opens it for all.
export function openBalancesModal({ focusAccountId = null } = {}) {
  if (!live(store.data.accounts).some(a => !a.archived)) {
    showToast(t('err-no-accounts'), { type: 'error' });
    return;
  }
  const today = todayKey();
  const date = h('input', { type: 'date', value: today });
  const pending = h('div', { class: 'balances-pending' });
  const tbody = h('tbody');
  const totalEl = h('div', { class: 'balances-total' });
  const fields = new Map();

  const day = () => (isDayKey(date.value) ? date.value : today);

  function renderPending() {
    const d = day();
    const items = overdueEntries(store.data, d)
      .concat(entriesOn(store.data, d, { openOnly: true }))
      .filter(e => e.amount !== 0);
    clear(pending);
    if (!items.length) return;
    pending.append(
      h('div', { class: 'banner banner-warning' }, icon('alert-triangle'), h('span', {}, tn('balances-pending', items.length))),
      h('div', { class: 'list' }, items.map(e => entryListItem(e))));
    refreshIcons();
  }

  function renderRows() {
    const summaries = accountSummaries(store.data, day());
    clear(tbody);
    orderedAccounts().forEach(({ kind, account }) => {
      if (kind === 'group') {
        tbody.appendChild(h('tr', { class: 'balances-group' },
          h('td', { colspan: 4 }, account.name, account.bank && account.bank !== account.name ? h('span', { class: 'muted' }, ` ${account.bank}`) : null)));
        return;
      }
      const computed = (summaries.get(account.id) || {}).ownBalance || 0;
      let f = fields.get(account.id);
      if (!f) {
        const input = moneyInput({ placeholder: '' });
        input.addEventListener('input', updateTotals);
        f = { input, diffEl: h('td', { class: 'num money' }) };
        fields.set(account.id, f);
      }
      f.computed = computed;
      f.input.placeholder = money(computed);
      tbody.appendChild(h('tr', { class: `balances-${kind} ${account.id === focusAccountId ? 'is-focus' : ''}` },
        h('td', {}, kind === 'own' || kind === 'child' ? h('span', { class: 'tree-mark' }, '└ ') : null, account.name,
          kind === 'own' ? [' ', badge(t('account-main'), 'badge-main')] : null),
        h('td', { class: 'num money muted' }, money(computed)),
        h('td', { class: 'balances-input' }, f.input),
        f.diffEl));
    });
    updateTotals();
  }

  function updateTotals() {
    let total = 0;
    let filled = 0;
    fields.forEach(f => {
      const text = f.input.value.trim();
      const cents = text ? f.input.readCents() : null;
      f.diffEl.textContent = '';
      f.diffEl.className = 'num money';
      if (text && cents === null) {
        f.diffEl.textContent = t('err-amount');
        f.diffEl.classList.add('warning');
        return;
      }
      if (cents === null) return;
      filled++;
      const diff = cents - f.computed;
      total += diff;
      f.diffEl.textContent = diff ? money(diff, { signed: true }) : t('balances-match');
      f.diffEl.classList.add(diff ? (diff > 0 ? 'positive' : 'negative') : 'muted');
    });
    totalEl.textContent = filled
      ? (total ? t('balances-total', { n: filled, amount: money(total, { signed: true }) }) : t('balances-total-match', { n: filled }))
      : t('balances-hint-empty');
    totalEl.className = `balances-total ${total < 0 ? 'negative' : total > 0 ? 'positive' : ''}`;
  }

  // Marking a pending payment done changes the computed balances: follow it.
  const unsubscribe = store.subscribe(() => { renderPending(); renderRows(); });
  date.addEventListener('change', () => { renderPending(); renderRows(); });
  renderPending();
  renderRows();

  const modal = openModal({
    title: t('balances-title'),
    wide: true,
    onClose: unsubscribe,
    body: h('div', { class: 'form-stack' },
      h('p', { class: 'field-hint' }, t('balances-explain')),
      h('div', { class: 'form-row' }, h('div', { class: 'form-group' }, h('label', {}, t('balances-date')), date)),
      pending,
      h('div', { class: 'table-scroll' }, h('table', { class: 'balances-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, t('col-account')),
          h('th', { class: 'num' }, t('balances-col-app')),
          h('th', {}, t('balances-col-bank')),
          h('th', { class: 'num' }, t('balances-col-diff')))),
        tbody)),
      totalEl),
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: t('balances-save'), kind: 'primary', onClick: (m) => {
          const items = [];
          let invalid = false;
          fields.forEach((f, accountId) => {
            const text = f.input.value.trim();
            if (!text) return;
            const cents = f.input.readCents();
            if (cents === null) invalid = true;
            else items.push({ accountId, actual: cents });
          });
          if (invalid) {
            showToast(t('err-amount'), { type: 'error' });
            return false;
          }
          if (!items.length) {
            showToast(t('balances-need-one'), { type: 'error' });
            return false;
          }
          const snap = store.snapshot();
          const result = store.reconcileMany(items, day(), t('reconcile-default-note'));
          showToast(result.adjusted
            ? t('toast-balances', { n: result.checked, amount: money(result.total, { signed: true }) })
            : t('toast-balances-match', { n: result.checked }), {
            type: 'success', duration: 8000, actionLabel: t('undo'), onAction: () => store.restore(snap)
          });
          m.close();
          return true;
        }
      }
    ]
  });
  const focused = focusAccountId && fields.get(focusAccountId);
  if (focused) {
    setTimeout(() => {
      focused.input.focus();
      focused.input.closest('tr').scrollIntoView({ block: 'center' });
    }, 60);
  }
  return modal;
}
