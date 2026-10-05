// Update banner: on start the app asks GitHub for the latest release and,
// when there is a newer one, offers to update right away.

import { t } from './i18n.js';
import { h, clear, icon, refreshIcons, openModal } from './ui.js';
import { showToast } from './toast.js';

const bridge = typeof window !== 'undefined' ? window.weUpdates || null : null;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export const updateState = { last: null, dismissed: null, phase: 'idle', progress: 0 };
const listeners = [];

function notify() {
  listeners.forEach(fn => fn(updateState));
}

export function onUpdateChange(fn) {
  listeners.push(fn);
}

export function updatesAvailable() {
  return Boolean(bridge);
}

export async function checkForUpdates({ manual = false } = {}) {
  if (!bridge) return null;
  updateState.phase = 'checking';
  notify();
  const result = await bridge.check();
  updateState.last = { ...result, at: new Date().toISOString() };
  updateState.phase = 'idle';
  notify();
  if (manual && result.ok && !result.available) {
    showToast(result.noReleases ? t('update-no-releases') : t('update-latest', { version: result.current }), { type: 'info' });
  }
  if (manual && !result.ok) showToast(t('update-check-failed'), { type: 'error' });
  return result;
}

function showNotes(result) {
  openModal({
    title: t('update-notes-title', { version: result.latest }),
    body: h('div', { class: 'release-notes' }, result.notes || t('update-no-notes')),
    actions: [{ label: t('close'), onClick: (m) => m.close() }]
  });
}

async function startDownload() {
  updateState.phase = 'downloading';
  updateState.progress = 0;
  notify();
  const result = await bridge.download();
  if (!result.ok) {
    updateState.phase = 'idle';
    notify();
    showToast(t('update-download-failed'), { type: 'error' });
    return;
  }
  updateState.phase = result.inPlace ? 'ready' : 'manual';
  notify();
}

async function install() {
  updateState.phase = 'installing';
  notify();
  const result = await bridge.install();
  if (!result.ok) {
    updateState.phase = 'ready';
    notify();
    showToast(t('update-install-failed'), { type: 'error' });
    return;
  }
  if (result.manual) {
    updateState.phase = 'manual';
    notify();
    showToast(t('update-manual-opened'), { type: 'info', duration: 10000 });
  }
}

export function renderUpdateBanner(el) {
  clear(el);
  const r = updateState.last;
  const show = r && r.ok && r.available && updateState.dismissed !== r.latest;
  el.hidden = !show;
  if (!show) return;

  let text;
  const actions = [];
  switch (updateState.phase) {
    case 'downloading':
      text = t('update-downloading', { percent: Math.round(updateState.progress * 100) });
      break;
    case 'ready':
      text = t('update-ready', { version: r.latest });
      actions.push(h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: install }, icon('rotate-ccw'), t('update-restart')));
      break;
    case 'installing':
      text = t('update-installing');
      break;
    case 'manual':
      text = t('update-manual', { version: r.latest });
      break;
    default:
      text = t('update-available', { version: r.latest, current: r.current });
      actions.push(
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: startDownload }, icon('download'), t('update-now')),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => showNotes(r) }, t('update-whats-new')),
        h('button', {
          type: 'button', class: 'btn btn-secondary btn-sm',
          onclick: () => { updateState.dismissed = r.latest; notify(); }
        }, t('update-later')));
  }
  el.append(h('div', { class: 'update-banner-text' }, icon('sparkles'), h('span', {}, text)));
  if (updateState.phase === 'downloading') {
    el.append(h('div', { class: 'update-progress' },
      h('div', { class: 'update-progress-bar', style: { width: `${Math.round(updateState.progress * 100)}%` } })));
  }
  if (actions.length) el.append(h('div', { class: 'update-banner-actions' }, actions));
  refreshIcons();
}

export function initUpdates(bannerEl) {
  if (!bridge || !bannerEl) return;
  bridge.onProgress((p) => {
    updateState.progress = p;
    notify();
  });
  onUpdateChange(() => renderUpdateBanner(bannerEl));
  setTimeout(() => checkForUpdates(), 2500);
  setInterval(() => checkForUpdates(), CHECK_EVERY_MS);
}
