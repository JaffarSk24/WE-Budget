// Net worth on screen: the card in Analytics (total, change over the
// period, breakdown, month-end line), the property and investments block on
// the Accounts screen with its dialogs, and the one-line total on the phone.

import Chart from 'chart.js/auto';
import { store } from '../store.js';
import { t } from '../i18n.js';
import { h, icon, money, lang, field, moneyInput, selectEl, openModal, badge, emptyState } from '../ui.js';
import { latestAssetValue, netWorthAt, netWorthHistory } from '../networth.js';
import { formatDate, isDayKey, todayKey } from '../dates.js';
import { ASSET_KINDS, live, makeAsset } from '../model.js';
import { showToast } from '../toast.js';
import { withUndo } from '../modals.js';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function shortMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(lang() === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', year: '2-digit' });
}

const GROUP_ICONS = { accounts: 'wallet', assets: 'gem', owedToMe: 'arrow-down', debts: 'landmark' };

// ---------- Analytics ----------

function drawHistory(canvas, points) {
  const text = cssVar('--text-secondary');
  const grid = cssVar('--border-color');
  const line = cssVar('--series-1');
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: points.map(p => shortMonth(p.month)),
      datasets: [{
        label: t('nw-title'), data: points.map(p => p.total / 100), borderColor: line, backgroundColor: line,
        borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.25, fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: items => formatDate(points[items[0].dataIndex].day, lang()),
            label: item => money(Math.round(item.parsed.y * 100))
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: text, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: text, maxTicksLimit: 6, callback: v => money(Math.round(v * 100), { decimals: false }) } }
      }
    }
  });
}

// The card and a function that draws its chart once the card is in the
// page (Chart.js measures its canvas). `months` follows the Analytics
// period; the history never goes before the tracking start.
export function netWorthCard(today, months) {
  const hist = netWorthHistory(store.data, today, months);
  const now = hist.points.length ? hist.points[hist.points.length - 1] : netWorthAt(store.data, today);
  const canvas = h('canvas', { role: 'img', 'aria-label': t('nw-chart-aria') });
  const change = hist.change;
  const card = h('div', { class: 'card nw-card' },
    h('div', { class: 'card-title-row' }, icon('chart-line'), h('h3', {}, t('nw-title'))),
    h('div', { class: 'nw-top' },
      h('div', { class: 'nw-total' },
        h('div', { class: `nw-total-value money ${now.total < 0 ? 'negative' : ''}` }, money(now.total)),
        h('div', { class: 'nw-change muted' }, change
          ? t('nw-change', { amount: money(change, { signed: true }), date: formatDate(hist.startDay, lang()) })
          : t('nw-change-none', { date: formatDate(hist.startDay, lang()) }))),
      h('dl', { class: 'nw-breakdown' }, now.groups.map(g => h('div', { class: 'nw-group' },
        h('dt', {}, icon(GROUP_ICONS[g.key]), t(`nw-group-${g.key}`)),
        h('dd', { class: 'money' }, money(g.amount)))))),
    now.transit > 0 ? h('p', { class: 'field-hint' }, t('nw-transit-hint', { amount: money(now.transit) })) : null,
    hist.points.length > 1 ? h('div', { class: 'an-chart nw-chart' }, canvas) : h('p', { class: 'field-hint' }, t('nw-chart-later')),
    h('p', { class: 'field-hint' }, t('nw-hint')));
  return { card, draw: () => (hist.points.length > 1 ? drawHistory(canvas, hist.points) : null) };
}

// ---------- assets ----------

function kindOptions() {
  return ASSET_KINDS.map(k => ({ value: k, label: t(`asset-kind-${k}`) }));
}

// Puts a value into the history: a second value on the same day replaces
// the first, so correcting a typo does not leave two.
export function withValue(values, date, amount) {
  return (values || []).filter(v => v.date !== date).concat({ date, amount }).sort((a, b) => a.date.localeCompare(b.date));
}

export function openAssetModal(asset = null) {
  const isNew = !asset;
  const src = asset || { kind: 'property' };
  const name = h('input', { type: 'text', value: src.name || '', placeholder: t('asset-name-placeholder') });
  const kind = selectEl(kindOptions(), src.kind || 'property');
  const value = moneyInput({ value: null });
  const date = h('input', { type: 'date', value: todayKey() });
  const note = h('textarea', { rows: 2, placeholder: t('note-placeholder') }, src.note || '');
  const history = !isNew && (asset.values || []).length
    ? h('div', { class: 'asset-history' },
      h('h4', {}, t('asset-history')),
      h('ul', {}, asset.values.slice().reverse().slice(0, 12).map(v => h('li', {},
        h('span', { class: 'muted' }, formatDate(v.date, lang())), h('span', { class: 'money' }, money(v.amount))))))
    : null;

  const actions = [];
  if (!isNew) {
    actions.push({
      label: t('delete'), kind: 'danger', onClick: (m) => {
        withUndo(t('toast-asset-deleted'), () => store.remove('assets', asset.id));
        m.close();
        return true;
      }
    });
  }
  actions.push({ label: t('cancel'), onClick: (m) => m.close() });
  actions.push({
    label: t('save'), kind: 'primary', onClick: (m) => {
      if (!name.value.trim()) { showToast(t('err-name'), { type: 'error' }); return false; }
      const patch = { name: name.value.trim(), kind: kind.value, note: note.value.trim() };
      if (isNew) {
        const cents = value.readCents();
        if (cents === null || cents < 0) { showToast(t('err-amount'), { type: 'error' }); return false; }
        if (!isDayKey(date.value)) { showToast(t('err-date'), { type: 'error' }); return false; }
        withUndo(t('toast-asset-added'), () => store.add('assets', makeAsset({ ...patch, values: [{ date: date.value, amount: cents }] })));
      } else {
        withUndo(t('toast-asset-saved'), () => store.update('assets', asset.id, patch));
      }
      m.close();
      return true;
    }
  });

  openModal({
    title: isNew ? t('asset-new') : t('asset-edit'),
    body: h('div', { class: 'form-stack' },
      h('div', { class: 'form-row' }, field(t('field-name'), name), field(t('asset-kind'), kind)),
      isNew ? h('div', { class: 'form-row' }, field(t('asset-value'), value, t('asset-value-hint')), field(t('asset-value-date'), date)) : null,
      field(t('field-note'), note),
      history),
    actions
  });
  setTimeout(() => name.focus(), 50);
}

export function openAssetValueModal(asset) {
  const last = latestAssetValue(asset);
  const amount = moneyInput({ value: last ? last.amount : null, autofocus: true });
  const date = h('input', { type: 'date', value: todayKey() });
  openModal({
    title: t('asset-update-value'),
    body: h('div', { class: 'form-stack' },
      h('p', { class: 'field-hint' }, t('asset-update-info', { name: asset.name })),
      h('div', { class: 'form-row' }, field(t('asset-value'), amount), field(t('asset-value-date'), date))),
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: t('save'), kind: 'primary', onClick: (m) => {
          const cents = amount.readCents();
          if (cents === null || cents < 0) { showToast(t('err-amount'), { type: 'error' }); return false; }
          if (!isDayKey(date.value)) { showToast(t('err-date'), { type: 'error' }); return false; }
          withUndo(t('toast-asset-value'), () => store.update('assets', asset.id, { values: withValue(asset.values, date.value, cents) }));
          m.close();
          return true;
        }
      }
    ]
  });
}

function toggleArchive(asset) {
  const patch = asset.archived ? { archived: false, archivedAt: null } : { archived: true, archivedAt: todayKey() };
  withUndo(asset.archived ? t('toast-asset-restored') : t('toast-asset-archived'), () => store.update('assets', asset.id, patch));
}

function actionBtn(iconName, label, onClick) {
  return h('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); onClick(); } }, icon(iconName));
}

// The block on the Accounts screen.
export function assetsCard() {
  const today = todayKey();
  const assets = live(store.data.assets || [])
    .sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name, lang()));
  const nw = netWorthAt(store.data, today);
  const rows = assets.map(a => {
    const last = latestAssetValue(a);
    return h('tr', { class: `asset-row ${a.archived ? 'is-archived' : ''}`, ondblclick: () => openAssetModal(a) },
      h('td', {}, h('div', { class: 'row-title' }, a.name, badge(t(`asset-kind-${a.kind}`), 'badge-muted'), a.archived ? badge(t('archived'), 'badge-muted') : null),
        a.note ? h('div', { class: 'row-meta' }, a.note) : null),
      h('td', { class: 'num money' }, last ? money(last.amount) : ''),
      h('td', { class: 'asset-date muted' }, last ? formatDate(last.date, lang()) : ''),
      h('td', { class: 'col-actions' },
        a.archived ? null : actionBtn('refresh-cw', t('asset-update-value'), () => openAssetValueModal(a)),
        actionBtn(a.archived ? 'archive-restore' : 'archive', a.archived ? t('asset-unarchive') : t('asset-archive'), () => toggleArchive(a)),
        actionBtn('pencil', t('edit'), () => openAssetModal(a))));
  });
  return h('div', { class: 'card table-card assets-card' },
    h('div', { class: 'card-title-row pad assets-head' }, icon('gem'), h('h3', {}, t('assets-title')),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => openAssetModal() }, icon('plus'), t('asset-new'))),
    assets.length
      ? h('div', { class: 'table-scroll' }, h('table', { class: 'acc-table assets-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('field-name')), h('th', { class: 'num' }, t('asset-value')), h('th', {}, t('asset-updated')), h('th', { class: 'col-actions' }))),
        h('tbody', {}, rows)))
      : h('div', { class: 'pad' }, emptyState(t('assets-empty'), 'gem')),
    h('p', { class: 'field-hint pad' }, t('assets-networth', { amount: money(nw.total) }), ' ', t('assets-hint')));
}

// One line on the phone's Accounts tab.
export function phoneNetWorth() {
  const nw = netWorthAt(store.data, todayKey());
  return h('section', { class: 'phone-card phone-networth' },
    h('div', { class: 'phone-acc-row is-top' },
      h('div', { class: 'phone-acc-name' }, t('nw-title'),
        h('span', { class: 'phone-acc-meta' }, t('nw-phone-meta', { assets: money(nw.assets + nw.owedToMe), debts: money(nw.debts) }))),
      h('div', { class: `phone-acc-free money ${nw.total < 0 ? 'negative' : ''}` }, money(nw.total))));
}
