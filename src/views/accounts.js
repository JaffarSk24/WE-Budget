// Accounts and envelopes: balances, reserved and free money, reconciliation,
// manual split, operation history of one account.

import { store } from '../store.js';
import { t } from '../i18n.js';
import { h, clear, icon, money, refreshIcons, lang, emptyState, badge, accountLabel, categoryName } from '../ui.js';
import { accountSummaries, accountEffect, compareEntries } from '../ledger.js';
import { formatDay, todayKey } from '../dates.js';
import { live } from '../model.js';
import { openAccountModal, openAllocationModal, openEntryModal } from '../modals.js';
import { openBalancesModal } from '../balances.js';

let selectedId = null;

function actionBtn(iconName, label, onClick, cls = '') {
  return h('button', { type: 'button', class: `icon-btn ${cls}`, title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); onClick(); } }, icon(iconName));
}

// Row kinds:
//   group  a bank account with envelopes: totals over the account and all
//          its envelopes (what the bank shows in the app overall);
//   own    the account itself inside its group, first in the list: its own
//          money, the one bills like the card plan are paid from;
//   child  an envelope;
//   single an account without envelopes (own and total are the same).
function accountRow(a, s, mode, root) {
  const own = mode !== 'group';
  const balance = own ? s.ownBalance : s.totalBalance;
  const reserved = own ? s.ownReserved : s.totalReserved;
  const free = own ? s.ownFree : s.totalFree;
  const nested = mode === 'own' || mode === 'child';
  const last = s.lastCheck;
  const canMove = mode !== 'group';
  return h('tr', {
    class: `acc-row acc-${mode} ${a.archived ? 'is-archived' : ''} ${a.id === selectedId && mode !== 'group' ? 'is-selected' : ''}`,
    onclick: () => { selectedId = a.id; renderAccounts(root); },
    ondblclick: () => openAccountModal(a)
  },
    h('td', { class: 'acc-name' },
      h('div', { class: 'row-title' }, nested ? h('span', { class: 'tree-mark' }, '└') : null, a.name,
        mode === 'own' ? badge(t('account-main'), 'badge-main') : null,
        mode !== 'group' && a.kind !== 'current' ? badge(t(`kind-${a.kind}`), 'badge-muted') : null,
        a.archived ? badge(t('archived'), 'badge-muted') : null),
      (mode === 'group' || mode === 'single') && a.bank && a.bank !== a.name ? h('div', { class: 'row-meta' }, a.bank) : null),
    h('td', { class: 'num money' }, money(balance)),
    h('td', { class: 'num money reserved' }, reserved ? money(reserved) : ''),
    h('td', { class: `num money ${free < 0 ? 'negative' : ''}` }, money(free)),
    h('td', { class: 'acc-check' }, mode === 'group' ? null : last
      ? h('span', { title: t('last-check-title') }, formatDay(last.date, lang()) + '.' + last.date.slice(2, 4),
        last.actualBalance !== last.computedBalance ? h('span', { class: 'muted' }, ' ' + money(last.actualBalance - last.computedBalance, { signed: true })) : null)
      : h('span', { class: 'muted' }, t('never'))),
    h('td', { class: 'col-actions' },
      // Checking against the bank and splitting money belong to a concrete
      // account, never to the sum of a group.
      canMove ? actionBtn('scale', t('balances-open'), () => openBalancesModal({ focusAccountId: a.id })) : null,
      canMove ? actionBtn('split', t('alloc-from-here'), () => openAllocationModal({ sourceAccountId: a.id })) : null,
      mode === 'group' || mode === 'single' ? actionBtn('folder-plus', t('account-add-envelope'), () => openAccountModal(null, { parentId: a.id })) : null,
      actionBtn('pencil', t('edit'), () => openAccountModal(a)))
  );
}

function history(accountId) {
  const start = store.settings.trackingStart || '0000-01-01';
  const entries = live(store.data.entries)
    .filter(e => (e.accountId === accountId || e.toAccountId === accountId) && e.date >= start && e.status !== 'cancelled')
    .sort(compareEntries)
    .reverse()
    .slice(0, 150);
  if (!entries.length) return h('p', { class: 'muted small' }, t('account-history-empty'));
  const today = todayKey();
  return h('table', { class: 'history-table' },
    h('tbody', {}, entries.map(e => {
      const effect = accountEffect(e, accountId);
      return h('tr', { class: `status-row-${e.status} ${e.date > today ? 'is-future' : ''}`, ondblclick: () => openEntryModal(e) },
        h('td', { class: 'col-date' }, formatDay(e.date, lang())),
        h('td', {}, h('div', { class: 'row-title' }, e.title || (e.type === 'transfer' ? t('transfer-label') : t('untitled'))),
          h('div', { class: 'row-meta' }, [
            e.type === 'transfer' ? (e.accountId === accountId ? t('transfer-to', { name: accountLabel(e.toAccountId) }) : t('transfer-from', { name: accountLabel(e.accountId) })) : null,
            e.categoryId ? categoryName(e.categoryId) : null,
            e.isAdjustment ? t('badge-adjustment') : null
          ].filter(Boolean).join(' · '))),
        h('td', {}, badge(t(`status-${e.status}`), `badge-status-${e.status}`)),
        h('td', { class: `num money ${effect > 0 ? 'positive' : ''}` }, money(effect, { signed: effect > 0 })));
    })));
}

export function renderAccounts(root) {
  clear(root);
  const accounts = live(store.data.accounts);
  const s = accountSummaries(store.data);
  const byOrder = (a, b) => (a.archived - b.archived) || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
  const tops = accounts.filter(a => !a.parentId).sort(byOrder);

  root.appendChild(h('div', { class: 'view-header' },
    h('div', {}, h('h1', { class: 'view-title' }, t('nav-accounts')), h('p', { class: 'view-subtitle' }, t('accounts-subtitle'))),
    h('div', { class: 'header-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openBalancesModal() }, icon('scale'), t('balances-open')),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openAllocationModal() }, icon('split'), t('alloc-open')),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openAccountModal() }, icon('plus'), t('account-new')))));

  if (!accounts.length) {
    root.appendChild(h('div', { class: 'card' }, emptyState(t('no-accounts-yet'), 'wallet')));
    refreshIcons();
    return;
  }

  const rows = [];
  tops.forEach(top => {
    const children = accounts.filter(a => a.parentId === top.id).sort(byOrder);
    if (!children.length) {
      rows.push(accountRow(top, s.get(top.id), 'single', root));
      return;
    }
    rows.push(accountRow(top, s.get(top.id), 'group', root));
    rows.push(accountRow(top, s.get(top.id), 'own', root));
    children.forEach(c => rows.push(accountRow(c, s.get(c.id), 'child', root)));
  });

  root.appendChild(h('div', { class: 'card table-card' },
    h('div', { class: 'table-scroll' }, h('table', { class: 'acc-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, t('col-account')), h('th', { class: 'num' }, t('col-balance')),
        h('th', { class: 'num' }, t('col-reserved')), h('th', { class: 'num' }, t('col-free')),
        h('th', {}, t('col-last-check')), h('th', { class: 'col-actions' }))),
      h('tbody', {}, rows))),
    h('p', { class: 'field-hint pad' }, t('accounts-hint'))));

  const selected = selectedId ? store.find('accounts', selectedId) : null;
  if (selected) {
    root.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-title-row' }, icon('history'), h('h3', {}, t('account-history', { name: accountLabel(selected.id) }))),
      history(selected.id)));
  }
  refreshIcons();
}
