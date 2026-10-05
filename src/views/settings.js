// Settings: language and theme, accounting basics, categories, data files.

import { store } from '../store.js';
import { t } from '../i18n.js';
import { showToast } from '../toast.js';
import {
  h, clear, icon, refreshIcons, lang, selectEl, accountOptions, moneyInput, confirmDialog,
  download, pickFile, accountLabel, categoryName
} from '../ui.js';
import { makeCategory, live, hasAnyData } from '../model.js';
import { isDayKey, todayKey, formatTimestamp } from '../dates.js';
import { buildDemo } from '../demo.js';
import { withUndo } from '../modals.js';
import { sync, signIn, cancelSignIn, signOut, syncStatusText } from '../cloud.js';
import { checkForUpdates, updateState, updatesAvailable } from '../updates.js';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CZK', 'PLN', 'UAH'];

function section(title, iconName, ...children) {
  return h('div', { class: 'card settings-section' },
    h('h3', { class: 'settings-section-title' }, icon(iconName), title),
    ...children);
}

function settingRow(label, control, hint = null) {
  return h('div', { class: 'setting-row' },
    h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, label), hint ? h('div', { class: 'setting-hint' }, hint) : null),
    h('div', { class: 'setting-control' }, control));
}

export function csvCell(value) {
  let s = String(value ?? '');
  // Formula prefixes are neutralized: protection against CSV injection.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function exportCsv() {
  const rows = [[t('col-date'), t('col-item'), t('csv-type'), t('col-amount'), t('col-account'), t('field-to-account'), t('field-category'), t('field-status'), t('field-note')]];
  live(store.data.entries)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach(e => rows.push([
      e.date, e.title, t(`type-${e.type}`), (e.amount / 100).toFixed(2).replace('.', lang() === 'ru' ? ',' : '.'),
      accountLabel(e.accountId), e.toAccountId ? accountLabel(e.toAccountId) : '',
      e.categoryId ? categoryName(e.categoryId) : '', t(`status-${e.status}`), e.note
    ]));
  const sep = lang() === 'ru' ? ';' : ',';
  download(`we-budget-${todayKey()}.csv`, '\ufeff' + rows.map(r => r.map(csvCell).join(sep)).join('\r\n'), 'text/csv;charset=utf-8');
}

function syncSection() {
  const st = sync.state;
  const rows = [];
  if (st.status === 'unavailable') {
    rows.push(h('p', { class: 'setting-hint' }, t('sync-desktop-only')));
  } else if (st.status === 'unconfigured') {
    rows.push(h('p', { class: 'setting-hint' }, t('sync-unconfigured')));
  } else if (st.status === 'checking') {
    rows.push(h('p', { class: 'setting-hint' }, t('sync-checking')));
  } else if (!sync.loggedIn) {
    rows.push(h('p', { class: 'setting-hint' }, st.status === 'reauth' ? t(st.reauthReason === 'drive_scope' ? 'sync-banner-scope' : 'sync-reauth-hint') : t('sync-explain')));
    rows.push(h('div', { class: 'inline-actions' },
      st.signingIn
        ? [h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, icon('loader'), t('sync-waiting-browser')),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: cancelSignIn }, t('cancel'))]
        : h('button', { type: 'button', class: 'btn btn-primary', onclick: signIn }, icon('log-in'),
          st.status === 'reauth' ? t('sync-login-again') : t('sync-login'))));
  } else {
    rows.push(settingRow(t('sync-account'), h('span', { class: 'setting-value' }, st.email || '')));
    rows.push(settingRow(t('sync-state'), h('span', { class: `setting-value sync-text-${st.status}` }, syncStatusText(st)),
      st.status === 'conflict' ? t('sync-conflict-hint') : st.status === 'offline' ? t('sync-offline-hint') : null));
    rows.push(h('div', { class: 'inline-actions' },
      h('button', {
        type: 'button', class: 'btn btn-secondary', disabled: st.status === 'syncing',
        onclick: () => sync.sync('manual')
      }, icon('refresh-cw'), t('sync-now')),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: signOut }, icon('log-out'), t('sync-logout'))));
    rows.push(h('p', { class: 'setting-hint' }, t('sync-where')));
  }
  return section(t('sync-title'), 'cloud', ...rows);
}

function updatesSection() {
  const last = updateState.last;
  let status = '';
  if (updateState.phase === 'checking') status = t('update-checking');
  else if (last && last.ok && last.available) status = t('update-available-short', { version: last.latest });
  else if (last && last.ok && last.noReleases) status = t('update-no-releases');
  else if (last && last.ok) status = t('update-latest', { version: last.current });
  else if (last && !last.ok) status = t('update-check-failed');
  return section(t('update-title'), 'download',
    settingRow(t('update-version'), h('span', { class: 'setting-value' }, typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''), status || null),
    updatesAvailable()
      ? h('div', { class: 'inline-actions' }, h('button', {
        type: 'button', class: 'btn btn-secondary', disabled: updateState.phase === 'checking',
        onclick: () => checkForUpdates({ manual: true })
      }, icon('refresh-cw'), t('update-check')))
      : h('p', { class: 'setting-hint' }, t('update-desktop-only')));
}

function categoriesSection(root) {
  const cats = store.list('categories').sort((a, b) => (a.type === b.type ? 0 : a.type === 'expense' ? -1 : 1) || a.archived - b.archived || a.name.localeCompare(b.name, lang()));
  const rows = cats.map(c => {
    const name = h('input', { type: 'text', value: c.name, class: 'inline-input' });
    name.addEventListener('change', () => { if (name.value.trim()) store.update('categories', c.id, { name: name.value.trim() }); });
    const limit = c.type === 'expense' ? moneyInput({ value: c.monthlyLimit, placeholder: t('cat-no-limit') }) : null;
    if (limit) {
      limit.classList.add('inline-input', 'limit-input');
      limit.addEventListener('change', () => {
        const v = limit.value.trim() ? limit.readCents() : null;
        if (limit.value.trim() && (v === null || v < 0)) { showToast(t('err-amount'), { type: 'error' }); return; }
        store.update('categories', c.id, { monthlyLimit: v || null });
      });
    }
    const used = live(store.data.entries).some(e => e.categoryId === c.id) || live(store.data.templates).some(x => x.categoryId === c.id);
    return h('tr', { class: c.archived ? 'is-archived' : '' },
      h('td', {}, name),
      h('td', {}, t(`type-${c.type}`)),
      h('td', {}, limit || h('span', { class: 'muted' }, '')),
      h('td', { class: 'col-actions' },
        h('button', {
          type: 'button', class: 'icon-btn', title: c.archived ? t('cat-unarchive') : t('cat-archive'),
          onclick: () => store.update('categories', c.id, { archived: !c.archived })
        }, icon(c.archived ? 'archive-restore' : 'archive')),
        h('button', {
          type: 'button', class: 'icon-btn danger', title: t('delete'), disabled: used,
          onclick: () => withUndo(t('toast-category-deleted'), () => store.remove('categories', c.id))
        }, icon('trash-2'))));
  });

  const newName = h('input', { type: 'text', placeholder: t('cat-new-placeholder') });
  const newType = selectEl([{ value: 'expense', label: t('type-expense') }, { value: 'income', label: t('type-income') }], 'expense');
  const add = () => {
    if (!newName.value.trim()) return;
    store.add('categories', makeCategory({ name: newName.value.trim(), type: newType.value }));
    renderSettings(root);
  };
  newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  return section(t('settings-categories'), 'tags',
    h('p', { class: 'setting-hint' }, t('settings-categories-hint')),
    h('div', { class: 'table-scroll cat-scroll' }, h('table', { class: 'cat-table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('field-name')), h('th', {}, t('csv-type')), h('th', {}, t('cat-limit')), h('th', {}))),
      h('tbody', {}, rows))),
    h('div', { class: 'inline-add' }, newName, newType, h('button', { type: 'button', class: 'btn btn-secondary', onclick: add }, icon('plus'), t('add'))));
}

export function renderSettings(root) {
  clear(root);
  const s = store.settings;

  root.appendChild(h('div', { class: 'view-header' },
    h('div', {}, h('h1', { class: 'view-title' }, t('nav-settings')), h('p', { class: 'view-subtitle' }, t('settings-subtitle')))));

  const language = selectEl([{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }], s.language);
  language.addEventListener('change', () => store.updateSettings({ language: language.value }));
  const theme = selectEl([{ value: 'dark', label: t('theme-dark') }, { value: 'light', label: t('theme-light') }], s.theme);
  theme.addEventListener('change', () => store.updateSettings({ theme: theme.value }));

  const currency = selectEl(CURRENCIES.map(c => ({ value: c, label: c })), s.currency);
  currency.addEventListener('change', () => store.updateSettings({ currency: currency.value }));
  const incomeAccount = selectEl(accountOptions({ emptyLabel: t('choose-account') }), s.defaultIncomeAccountId || '');
  incomeAccount.addEventListener('change', () => store.updateSettings({ defaultIncomeAccountId: incomeAccount.value || null }));
  const horizon = selectEl([1, 2, 3, 6, 12].map(n => ({ value: String(n), label: t('months-n', { n }) })), String(s.forecastMonths || 3));
  horizon.addEventListener('change', () => { store.updateSettings({ forecastMonths: Number(horizon.value) }); store.generate(); });
  const tracking = h('input', { type: 'date', value: s.trackingStart || '' });
  tracking.addEventListener('change', async () => {
    if (!isDayKey(tracking.value)) { tracking.value = s.trackingStart || ''; return; }
    const ok = await confirmDialog(t('tracking-confirm'), { okLabel: t('change') });
    if (ok) withUndo(t('toast-saved'), () => store.updateSettings({ trackingStart: tracking.value }));
    else tracking.value = s.trackingStart || '';
  });

  root.appendChild(syncSection());

  root.appendChild(section(t('settings-look'), 'palette',
    settingRow(t('settings-language'), language),
    settingRow(t('settings-theme'), theme)));

  root.appendChild(section(t('settings-accounting'), 'calculator',
    settingRow(t('settings-tracking'), tracking, t('settings-tracking-hint')),
    settingRow(t('settings-income-account'), incomeAccount, t('settings-income-account-hint')),
    settingRow(t('settings-horizon'), horizon, t('settings-horizon-hint')),
    settingRow(t('settings-currency'), currency)));

  root.appendChild(categoriesSection(root));

  const isElectron = !!window.weStorage;
  root.appendChild(section(t('settings-data'), 'database',
    settingRow(t('backup-download'), h('button', {
      type: 'button', class: 'btn btn-secondary',
      onclick: () => download(`we-budget-backup-${todayKey()}.json`, JSON.stringify(store.data, null, 1))
    }, icon('download'), t('download')), t('backup-download-hint')),
    settingRow(t('backup-restore'), h('button', {
      type: 'button', class: 'btn btn-secondary', onclick: async () => {
        const file = await pickFile('.json,application/json');
        if (!file) return;
        let parsed;
        try { parsed = JSON.parse(file.text); } catch (e) { showToast(t('err-file'), { type: 'error' }); return; }
        if (!parsed || !Array.isArray(parsed.entries) || !parsed.settings) { showToast(t('err-file'), { type: 'error' }); return; }
        const ok = await confirmDialog(t('restore-confirm', { name: file.name, n: parsed.entries.length }), { danger: true, okLabel: t('restore') });
        if (!ok) return;
        const snap = store.snapshot();
        store.replaceAll(parsed);
        store.generate();
        showToast(t('toast-restored'), { type: 'success', actionLabel: t('undo'), onAction: () => store.applySynced(snap) });
      }
    }, icon('upload'), t('restore')), t('backup-restore-hint')),
    settingRow(t('export-csv'), h('button', { type: 'button', class: 'btn btn-secondary', onclick: exportCsv }, icon('file-spreadsheet'), t('export')), t('export-csv-hint')),
    isElectron ? settingRow(t('backups-folder'), h('button', {
      type: 'button', class: 'btn btn-secondary', onclick: () => window.weStorage.backupsFolder()
    }, icon('folder-open'), t('open')), t('backups-folder-hint')) : null,
    settingRow(t('demo-load'), h('button', {
      type: 'button', class: 'btn btn-secondary', onclick: async () => {
        if (hasAnyData(store.data)) {
          const ok = await confirmDialog(t('demo-confirm'), { danger: true, okLabel: t('demo-load') });
          if (!ok) return;
        }
        const snap = store.snapshot();
        store.replaceAll(buildDemo(todayKey(), lang()));
        showToast(t('toast-demo'), { type: 'success', actionLabel: t('undo'), onAction: () => store.applySynced(snap) });
      }
    }, icon('sparkles'), t('demo-load-btn')), t('demo-load-hint')),
    settingRow(t('reset-all'), h('button', {
      type: 'button', class: 'btn btn-danger', onclick: async () => {
        const ok = await confirmDialog(t('reset-confirm'), { danger: true, okLabel: t('reset-all') });
        if (!ok) return;
        const snap = store.snapshot();
        store.replaceAll({ settings: { language: s.language, theme: s.theme } });
        showToast(t('toast-reset'), { type: 'success', actionLabel: t('undo'), onAction: () => store.applySynced(snap) });
      }
    }, icon('trash-2'), t('reset-all-btn')), t('reset-all-hint'))));

  root.appendChild(updatesSection());

  const stats = store.list('entries').length;
  root.appendChild(section(t('settings-about'), 'info',
    h('p', {}, `WE Budget ${typeof __APP_VERSION__ !== 'undefined' ? 'v' + __APP_VERSION__ : ''}`),
    h('p', { class: 'setting-hint' }, t('about-stats', { n: stats, updated: formatTimestamp(s.updatedAt, lang()) })),
    h('p', {}, h('a', { href: 'https://whiteeagles.sk/', target: '_blank', rel: 'noopener' }, 'White Eagles & Co. s.r.o.'))));

  refreshIcons();
}
