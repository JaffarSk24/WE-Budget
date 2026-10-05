// WE Budget entry point: fonts, icons, navigation, global keys, day change.

// Local fonts: no Google Fonts CDN, the app works offline.
import { isAuthWindow } from './web/boot.js';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/outfit/800.css';
import { createIcons } from 'lucide';
import { usedIcons } from './icons.js';
import { store } from './store.js';
import { t, translatePage } from './i18n.js';
import { initModalKeys, topModal, h } from './ui.js';
import { renderOverview } from './views/overview.js';
import { renderMonth, handleMonthKey } from './views/month.js';
import { renderAccounts } from './views/accounts.js';
import { renderTemplates } from './views/templates.js';
import { renderSettings } from './views/settings.js';
import { renderWelcome } from './views/welcome.js';
import { openQuickExpense, openEntryModal } from './modals.js';
import { todayKey } from './dates.js';
import { hasAnyData } from './model.js';
import { setNavigator } from './router.js';
import { sync, initSyncStatus, initSyncBanner } from './cloud.js';
import { initUpdates, onUpdateChange } from './updates.js';
import { initReminders, onReminderChange } from './reminder-sync.js';
import { initNotifications } from './notify.js';
import { finishRedirectSignIn } from './web/cloud-web.js';
import { isPhoneLayout, initPhone } from './views/phone.js';

window.lucide = { createIcons: () => createIcons({ icons: usedIcons }) };

const VIEWS = {
  overview: renderOverview,
  month: renderMonth,
  accounts: renderAccounts,
  templates: renderTemplates,
  settings: renderSettings,
  welcome: renderWelcome
};
const NAV_ORDER = ['overview', 'month', 'accounts', 'templates', 'settings'];
const LAST_VIEW_KEY = 'we-budget-last-view';

let current = null;
let lastDay = todayKey();

function needsWelcome() {
  return !store.settings.onboarded && !hasAnyData(store.data);
}

function viewFromHash() {
  const name = (window.location.hash || '').replace('#', '');
  return VIEWS[name] ? name : null;
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', store.settings.theme === 'light' ? 'light' : 'dark');
}

function show(name) {
  if (needsWelcome()) name = 'welcome';
  else if (name === 'welcome') name = 'month';
  current = name;
  try { if (name !== 'welcome') localStorage.setItem(LAST_VIEW_KEY, name); } catch (e) { /* optional */ }
  document.querySelectorAll('.view-panel').forEach(p => p.classList.toggle('active', p.id === `view-${name}`));
  document.querySelectorAll('#main-nav .nav-item').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  document.body.classList.toggle('is-welcome', name === 'welcome');
  render();
  const main = document.querySelector('main');
  if (main) main.scrollTop = 0;
}

function render() {
  if (!current) return;
  const root = document.getElementById(`view-${current}`);
  if (root) VIEWS[current](root);
  translatePage();
}

function showLoadError() {
  if (!store.loadError) return;
  document.body.prepend(h('div', { class: 'banner banner-danger global-banner', role: 'alert' }, t('load-error')));
}

// Templates fill the plan up to the horizon; on a new day the horizon may
// move and overdue rows change, so regenerate and redraw.
function checkDay() {
  const day = todayKey();
  if (day === lastDay) return;
  lastDay = day;
  store.generate(day);
  render();
}

function initKeys() {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !topModal() && (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т')) {
      e.preventDefault();
      if (e.shiftKey) openEntryModal(null, {});
      else openQuickExpense();
      return;
    }
    if (mod && !e.shiftKey && /^[1-5]$/.test(e.key) && !needsWelcome()) {
      e.preventDefault();
      window.location.hash = '#' + NAV_ORDER[Number(e.key) - 1];
      return;
    }
    if (current === 'month' && handleMonthKey(e)) e.preventDefault();
  });
}

// The phone app works offline: a service worker keeps its files (web build
// only; the desktop app has them on disk).
function registerServiceWorker() {
  if (window.weStorage || !('serviceWorker' in navigator) || typeof __WEB_BUILD__ === 'undefined' || !__WEB_BUILD__) return;
  navigator.serviceWorker.register('./sw.js').catch(e => console.error('service worker', e));
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  // Google's answer in the sign-in window: the app does not start here.
  if (isAuthWindow) {
    document.body.replaceChildren(h('p', { class: 'auth-window-note' }, t('auth-window-done')));
    return;
  }
  const phone = isPhoneLayout();
  const yearEl = document.getElementById('current-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
  const versionEl = document.getElementById('app-version');
  if (versionEl && typeof __APP_VERSION__ !== 'undefined') versionEl.textContent = 'v' + __APP_VERSION__;

  document.querySelectorAll('#main-nav .nav-item').forEach(a => {
    a.setAttribute('href', '#' + a.dataset.view);
  });
  document.getElementById('quick-add-btn').addEventListener('click', () => openQuickExpense());
  window.addEventListener('hashchange', () => { if (!phone) show(viewFromHash() || 'month'); });
  setNavigator((name) => show(name));

  initModalKeys();
  initKeys();
  showLoadError();
  initSyncStatus(document.getElementById('sync-status'));
  initSyncBanner(document.getElementById('sync-banner'));
  initUpdates(document.getElementById('update-banner'));
  sync.onChange(() => { if (current === 'settings' || current === 'welcome') render(); });
  onUpdateChange(() => { if (current === 'settings') render(); });
  onReminderChange(() => { if (current === 'settings') render(); });

  // Before the window closes, unsent changes go to the cloud (the main
  // process waits a few seconds at most).
  if (window.weApp) {
    window.weApp.onBeforeClose(async () => {
      try {
        await Promise.race([sync.flush(), new Promise(r => setTimeout(r, 7000))]);
      } finally {
        window.weApp.closeReady();
      }
    });
  }

  if (!needsWelcome()) store.generate();
  if (phone) {
    store.subscribe(() => applyTheme());
    initPhone(document.getElementById('phone-app'));
  } else {
    store.subscribe(() => {
      applyTheme();
      if (current === 'welcome' && !needsWelcome()) return; // the welcome screen navigates itself
      if (current !== 'welcome' && needsWelcome()) { show('welcome'); return; }
      render();
    });

    let initial = viewFromHash();
    if (!initial) {
      try { initial = localStorage.getItem(LAST_VIEW_KEY); } catch (e) { initial = null; }
    }
    show(VIEWS[initial] ? initial : 'month');
  }
  // A sign-in that had to leave the page (web, windows blocked) is finished
  // here; its first sync may then ask about two different budgets.
  const finishing = window.weStorage ? Promise.resolve(false) : finishRedirectSignIn();
  finishing
    .then(signedIn => sync.init({ reason: signedIn ? 'login' : 'startup' }))
    .catch(e => console.error('sync init failed', e))
    .finally(() => initReminders());
  initNotifications();
  registerServiceWorker();
  setInterval(checkDay, 60 * 1000);
  window.addEventListener('focus', checkDay);
});
