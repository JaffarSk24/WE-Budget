// The app's sync engine and the pieces of interface around it: the status
// line in the sidebar and the sign-in.

import { store } from './store.js';
import { t } from './i18n.js';
import { SyncEngine } from './sync/engine.js';
import { h, lang, icon, refreshIcons, clear } from './ui.js';
import { formatTimestamp } from './dates.js';
import { showToast } from './toast.js';

// Both originals of a merge are kept: on the desktop in the backups folder,
// in the browser the latest pair in local storage.
function keepCopy(tag, json) {
  if (typeof window === 'undefined') return;
  if (window.weStorage && typeof window.weStorage.keepCopy === 'function') {
    window.weStorage.keepCopy(tag, json);
    return;
  }
  try { localStorage.setItem(`we-budget-copy-${tag}`, json); } catch (e) { /* no room: the merge itself keeps everything */ }
}

export const sync = new SyncEngine({
  store,
  bridge: typeof window !== 'undefined' ? window.weCloud || null : null,
  keepCopy,
  afterApply: () => store.generate()
});

// Sign-in from the settings or the welcome screen. Resolves to true when
// the account is connected and the first sync ran.
export async function signIn() {
  if (sync.state.signingIn) return false;
  sync.setState({ signingIn: true });
  try {
    const result = await sync.login(lang());
    if (result && result.error === 'drive_scope_missing') {
      showToast(t('sync-scope-missing'), { type: 'error', duration: 12000 });
      if (sync.state.status === 'reauth') sync.setState({ reauthReason: 'drive_scope' });
      return false;
    }
    if (!result || !result.ok) {
      const quiet = result && (result.error === 'timeout' || result.error === 'access_denied' || result.error === 'cancelled');
      if (!quiet) showToast(result && result.offline ? t('sync-login-offline') : t('sync-login-failed'), { type: 'error' });
      return false;
    }
    const outcome = result.synced && result.synced.outcome;
    const key = outcome === 'pulled' ? 'sync-login-pulled' : outcome === 'merged' ? 'sync-login-merged' : 'sync-login-ok';
    showToast(t(key, { email: sync.state.email }), { type: 'success', duration: 7000 });
    return true;
  } finally {
    sync.setState({ signingIn: false });
  }
}

// The web app's access lasts an hour; a tap opens Google's window, which
// answers at once while its session is alive, and sync goes on.
export async function renewAccess() {
  if (!sync.bridge || typeof sync.bridge.renew !== 'function' || sync.state.signingIn) return false;
  sync.setState({ signingIn: true });
  try {
    const result = await sync.bridge.renew();
    if (!result || !result.ok) {
      if (result && result.error === 'drive_scope_missing') showToast(t('sync-scope-missing'), { type: 'error', duration: 12000 });
      return false;
    }
    // Like a launch: take what the cloud has; own changes go up on closing.
    await sync.sync('renew');
    return true;
  } finally {
    sync.setState({ signingIn: false });
  }
}

export async function cancelSignIn() {
  if (window.weCloud) await window.weCloud.cancelLogin();
  sync.setState({ signingIn: false });
}

export async function signOut() {
  await sync.logout();
  showToast(t('sync-logged-out'), { type: 'info' });
}

export function syncStatusText(state = sync.state) {
  switch (state.status) {
    case 'idle': if (state.pending) return t('sync-pending');
      return state.lastSyncAt
      ? t('sync-idle', { time: formatTimestamp(state.lastSyncAt, lang()) })
      : t('sync-idle-never');
    case 'syncing': return t('sync-syncing');
    case 'offline': return t('sync-offline');
    case 'renew': return t('sync-renew');
    case 'reauth': return t('sync-reauth');
    case 'error': return t('sync-error');
    case 'off': return t('sync-off');
    default: return '';
  }
}

const STATUS_ICON = {
  idle: 'cloud', syncing: 'refresh-cw', offline: 'cloud-off', renew: 'refresh-cw', reauth: 'log-in',
  error: 'alert-triangle', off: 'cloud-off'
};

// The line at the bottom of the sidebar; a click opens the sync settings.
export function initSyncStatus(el) {
  if (!el) return;
  const render = () => {
    const text = syncStatusText();
    clear(el);
    el.hidden = !text;
    if (!text) return;
    el.className = `sync-status sync-${sync.state.status}`;
    el.append(icon(STATUS_ICON[sync.state.status] || 'cloud'), h('span', {}, text));
    refreshIcons();
  };
  el.addEventListener('click', () => {
    if (sync.state.status === 'renew') renewAccess();
    else window.location.hash = '#settings';
  });
  sync.onChange(render);
  store.subscribe(render);
  render();
}

// Sync stopped because Google wants a new sign-in. A line in the sidebar is
// easy to miss, so a banner stays on top of every screen until the owner
// signs in again; "Later" hides it until the next start of the app.
export function initSyncBanner(el) {
  if (!el) return;
  let hiddenForNow = false;
  const render = () => {
    const st = sync.state;
    const show = st.status === 'reauth' && !hiddenForNow;
    clear(el);
    el.hidden = !show;
    if (!show) return;
    const text = st.reauthReason === 'drive_scope' ? t('sync-banner-scope') : t('sync-banner-expired');
    el.append(
      h('div', { class: 'sync-banner-text' }, icon('cloud-off'),
        h('div', {}, h('strong', {}, t('sync-banner-title')), ' ', h('span', {}, text))),
      h('div', { class: 'sync-banner-actions' }, st.signingIn
        ? [h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: true }, icon('loader'), t('sync-waiting-browser')),
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: cancelSignIn }, t('cancel'))]
        : [h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => signIn() }, icon('log-in'), t('sync-login')),
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { hiddenForNow = true; render(); } }, t('sync-banner-later'))]));
    refreshIcons();
  };
  sync.onChange(render);
  render();
}
