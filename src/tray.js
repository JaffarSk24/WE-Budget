// The menu bar of the Mac (the notification area on Windows): free money
// next to the icon and a quick expense in its menu, kept in step with the
// budget.

import { store } from './store.js';
import { t } from './i18n.js';
import { grandTotals } from './ledger.js';
import { money } from './ui.js';
import { openQuickExpense } from './modals.js';
import { hasAnyData } from './model.js';

let last = null;
let timer = null;

function send() {
  const totals = grandTotals(store.data);
  const state = {
    show: store.settings.menuBarFree !== false && hasAnyData(store.data),
    title: money(totals.free, { decimals: false }),
    tooltip: `WE Budget: ${t('kpi-free')} ${money(totals.free)}`,
    free: `${t('kpi-free')}: ${money(totals.free)}`,
    quick: t('quick-add'),
    open: t('tray-open'),
    quit: t('tray-quit')
  };
  const key = JSON.stringify(state);
  if (key === last) return;
  last = key;
  window.weApp.setTray(state);
}

export function initTray() {
  if (!window.weApp || typeof window.weApp.setTray !== 'function') return;
  window.weApp.onQuickExpense(() => openQuickExpense());
  store.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(send, 400);
  });
  send();
}
