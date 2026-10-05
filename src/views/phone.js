// The phone app. What the phone is for: payments of today and overdue ones,
// marking them, a quick expense, what is free on the accounts, reminders.
// Planning, recurring payments and accounts are edited on the computer.

import { store } from '../store.js';
import { t } from '../i18n.js';
import { h, clear, icon, money, refreshIcons, lang, accountLabel } from '../ui.js';
import { accountSummaries, entriesOn, grandTotals, overdueEntries, upcomingEntries } from '../ledger.js';
import { addDays, formatDay, formatDayLong, isDayKey, todayKey } from '../dates.js';
import { statusButton, reserveButton } from '../actions.js';
import { openEntryModal, openQuickExpense } from '../modals.js';
import { live, hasAnyData } from '../model.js';
import { sync, syncStatusText, signIn, renewAccess, initSyncBanner } from '../cloud.js';
import { syncSection, remindersSection, section, settingRow } from './settings.js';
import { buildDemo } from '../demo.js';
import { selectEl } from '../ui.js';

const TABS = [
  { id: 'today', icon: 'calendar-check', label: 'today-title' },
  { id: 'accounts', icon: 'wallet', label: 'phone-tab-accounts' },
  { id: 'more', icon: 'settings', label: 'phone-tab-more' }
];

let tab = 'today';
let focusDay = null;
let parts = null;

// Phone layout: the web app on a narrow screen.
export function isPhoneLayout() {
  return !window.weStorage && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
}

function readHash() {
  const m = /^#day=(\d{4}-\d{2}-\d{2})$/.exec(window.location.hash || '');
  if (m && isDayKey(m[1])) {
    focusDay = m[1];
    tab = 'today';
  }
}

function syncChip() {
  const st = sync.state;
  const text = syncStatusText(st);
  if (!text) return null;
  return h('button', {
    type: 'button', class: `phone-sync sync-${st.status}`,
    onclick: () => {
      if (st.status === 'renew') renewAccess();
      else if (st.status === 'off' || st.status === 'reauth') { tab = 'more'; render(); }
      else sync.sync('manual');
    }
  }, icon(st.status === 'syncing' || st.status === 'renew' ? 'refresh-cw' : st.status === 'idle' ? 'cloud' : 'cloud-off'), h('span', {}, text));
}

// A row sized for a finger: the status circle marks the payment done, the
// piggy bank sets money aside, a tap on the row opens it for editing. The
// date goes into the second line, so the title keeps its room.
function phoneEntry(entry, { showDate }) {
  const today = todayKey();
  const overdue = (entry.status === 'planned' || entry.status === 'reserved') && entry.date < today;
  const sign = entry.type === 'income' ? 1 : entry.type === 'expense' ? -1 : 0;
  const unreserved = entry.type === 'expense' && entry.status === 'planned' && entry.amount !== 0 && !entry.isTransit;
  const where = entry.type === 'transfer'
    ? `${accountLabel(entry.accountId)} → ${accountLabel(entry.toAccountId)}`
    : accountLabel(entry.accountId);
  return h('div', {
    class: `phone-entry status-row-${entry.status} ${overdue ? 'is-overdue' : ''} ${unreserved ? 'is-unreserved' : ''}`,
    onclick: () => openEntryModal(entry)
  },
    statusButton(entry),
    h('div', { class: 'phone-entry-main' },
      h('span', { class: 'phone-entry-title' }, entry.title || t('untitled')),
      h('span', { class: 'phone-entry-meta' },
        [showDate ? formatDay(entry.date, lang()) : null, where, entry.status === 'reserved' ? t('status-reserved') : null]
          .filter(Boolean).join(' · '))),
    h('span', { class: `phone-entry-amount money ${sign > 0 ? 'positive' : sign === 0 ? 'neutral' : ''}` },
      sign === 0 ? money(entry.amount) : money(sign * entry.amount, { signed: sign > 0 })),
    reserveButton(entry));
}

function list(title, entries, emptyText, cls = '') {
  return h('section', { class: `phone-card ${cls}` },
    h('div', { class: 'phone-card-title' }, h('h2', {}, title), entries.length ? h('span', { class: 'count-pill' }, entries.length) : null),
    entries.length
      ? h('div', { class: 'phone-list' }, entries.map(e => phoneEntry(e, { showDate: cls !== 'is-today' })))
      : h('p', { class: 'muted small' }, emptyText));
}

function todayTab() {
  const today = todayKey();
  const totals = grandTotals(store.data);
  const parts = [
    h('section', { class: 'phone-card phone-free' },
      h('div', { class: 'phone-free-label' }, t('kpi-free')),
      h('div', { class: `phone-free-value money ${totals.free < 0 ? 'negative' : ''}` }, money(totals.free)),
      h('div', { class: 'phone-free-sub' }, t('phone-free-sub', { reserved: money(totals.reserved), balance: money(totals.balance) })))
  ];
  if (focusDay && focusDay !== today) {
    parts.push(list(t('phone-day-title', { date: formatDayLong(focusDay, lang()) }), entriesOn(store.data, focusDay), t('today-none'), 'is-focus'));
  }
  const overdue = overdueEntries(store.data, today);
  if (overdue.length) parts.push(list(t('phone-overdue'), overdue, '', 'is-overdue'));
  const todays = entriesOn(store.data, today).filter(e => e.status !== 'cancelled');
  parts.push(list(t('today-title'), todays, t('today-none'), 'is-today'));
  parts.push(list(t('week-title'), upcomingEntries(store.data, addDays(today, 1), addDays(today, 7)), t('week-none')));
  return parts;
}

function accountsTab() {
  const accounts = live(store.data.accounts).filter(a => !a.archived);
  if (!accounts.length) return [h('p', { class: 'muted' }, t('no-accounts-yet'))];
  const s = accountSummaries(store.data);
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
  return accounts.filter(a => !a.parentId).sort(byOrder).map(top => {
    const sum = s.get(top.id) || {};
    const children = accounts.filter(a => a.parentId === top.id).sort(byOrder);
    const row = (name, balance, reserved, free, cls = '') => h('div', { class: `phone-acc-row ${cls}` },
      h('div', { class: 'phone-acc-name' }, name,
        reserved ? h('span', { class: 'phone-acc-meta' }, t('phone-acc-reserved', { amount: money(reserved), balance: money(balance) })) : null),
      h('div', { class: `phone-acc-free money ${free < 0 ? 'negative' : ''}` }, money(free)));
    return h('section', { class: 'phone-card' },
      row(top.name, children.length ? sum.totalBalance : sum.ownBalance, children.length ? sum.totalReserved : sum.ownReserved,
        children.length ? sum.totalFree : sum.ownFree, 'is-top'),
      children.length ? row(t('account-main'), sum.ownBalance, sum.ownReserved, sum.ownFree, 'is-child') : null,
      ...children.map(c => {
        const cs = s.get(c.id) || {};
        return row(c.name, cs.ownBalance, cs.ownReserved, cs.ownFree, 'is-child');
      }));
  });
}

function moreTab() {
  const s = store.settings;
  const language = selectEl([{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }], s.language);
  language.addEventListener('change', () => store.updateSettings({ language: language.value }));
  const theme = selectEl([{ value: 'dark', label: t('theme-dark') }, { value: 'light', label: t('theme-light') }], s.theme);
  theme.addEventListener('change', () => store.updateSettings({ theme: theme.value }));
  return [
    syncSection(),
    remindersSection(),
    section(t('settings-look'), 'palette',
      settingRow(t('settings-language'), language),
      settingRow(t('settings-theme'), theme)),
    h('p', { class: 'muted small phone-note' }, t('phone-desktop-note')),
    h('p', { class: 'muted small phone-note' },
      'WE Budget ', typeof __APP_VERSION__ !== 'undefined' ? 'v' + __APP_VERSION__ : '', ' · ',
      h('a', { href: 'https://whiteeagles.sk/', target: '_blank', rel: 'noopener' }, 'White Eagles & Co. s.r.o.'))
  ];
}

function welcome() {
  const st = sync.state;
  return [h('section', { class: 'phone-card phone-welcome' },
    h('h2', {}, t('phone-welcome-title')),
    h('p', {}, t('phone-welcome-text')),
    h('button', {
      type: 'button', class: 'btn btn-primary phone-wide', disabled: Boolean(st.signingIn), onclick: () => signIn()
    }, icon(st.signingIn ? 'loader' : 'log-in'), st.signingIn ? t('sync-waiting-browser') : t('sync-login')),
    h('button', {
      type: 'button', class: 'btn btn-secondary phone-wide',
      onclick: () => store.replaceAll(buildDemo(todayKey(), lang()))
    }, icon('sparkles'), t('phone-welcome-demo')),
    h('p', { class: 'muted small' }, t('phone-welcome-note')),
    h('p', { class: 'muted small' }, t('phone-install-hint')))];
}

function render() {
  if (!parts) return;
  const empty = !hasAnyData(store.data);
  clear(parts.chip);
  const chip = empty ? null : syncChip();
  if (chip) parts.chip.appendChild(chip);
  clear(parts.main);
  const content = empty ? welcome() : tab === 'accounts' ? accountsTab() : tab === 'more' ? moreTab() : todayTab();
  content.filter(Boolean).forEach(el => parts.main.appendChild(el));
  parts.fab.hidden = empty || tab === 'more';
  parts.tabs.hidden = empty;
  parts.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  refreshIcons();
}

export function initPhone(root) {
  document.body.classList.add('is-phone');
  readHash();
  const chip = h('div', { class: 'phone-chip' });
  const banner = h('div', { class: 'sync-banner', role: 'alert', hidden: true });
  const main = h('div', { class: 'phone-main' });
  const fab = h('button', { type: 'button', class: 'phone-fab', 'aria-label': t('quick-add'), onclick: () => openQuickExpense() }, icon('plus'));
  const tabs = h('nav', { class: 'phone-tabs' }, TABS.map(x => h('button', {
    type: 'button', 'data-tab': x.id,
    onclick: () => { tab = x.id; focusDay = null; if (window.location.hash) history.replaceState(null, '', window.location.pathname); render(); window.scrollTo(0, 0); }
  }, icon(x.icon), h('span', {}, t(x.label)))));
  root.append(
    h('header', { class: 'phone-top' },
      h('div', { class: 'phone-brand' }, h('img', { src: './white-eagles-logo-white.webp', alt: '', width: 22, height: 22 }), h('span', {}, 'WE Budget')),
      chip),
    banner, main, fab, tabs);
  root.hidden = false;
  parts = { chip, main, fab, tabs };
  initSyncBanner(banner);
  store.subscribe(render);
  sync.onChange(render);
  window.addEventListener('hashchange', () => { readHash(); render(); });
  render();
}

export function renderPhone() {
  render();
}
