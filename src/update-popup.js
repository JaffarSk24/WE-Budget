// The large window about a new version, after WE Invoice: when the check at
// start (or a later one) finds a newer release, it opens over the app once
// per version and run, with the new and the installed version, what is new
// and one large "Update" button. It then shows the download and "Restart
// and update", the same steps as the banner, which stays as a reminder
// after "Later". "Later" (or the cross, Esc, a click outside) closes it until
// the next start.

import { t } from './i18n.js';
import { h, clear, icon, refreshIcons, openModal } from './ui.js';

// The release notes up to their download section: how to install a file is
// for the release page, inside the app the update installs itself.
export function notesForApp(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const cut = lines.findIndex(l => /^\s*(\*\*|#{1,6}\s*)Downloads\b/i.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trim();
}

function inlineText(line) {
  return line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
}

// Release notes are short Markdown: headings, bold lines, list items. They
// become text nodes, never HTML.
export function notesView(markdown) {
  const nodes = [];
  let list = null;
  String(markdown || '').split(/\r?\n/).forEach(raw => {
    const line = raw.trimEnd();
    const heading = /^#{1,6}\s+(.*)$/.exec(line) || /^\*\*([^*]+)\*\*$/.exec(line.trim());
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) { list = null; nodes.push(h('h4', {}, inlineText(heading[1]))); } else if (item) {
      if (!list) { list = h('ul', {}); nodes.push(list); }
      list.append(h('li', {}, inlineText(item[1])));
    } else if (line.trim()) { list = null; nodes.push(h('p', {}, inlineText(line))); } else list = null;
  });
  return h('div', { class: 'update-popup-notes' }, nodes.length ? nodes : h('p', { class: 'muted' }, t('update-no-notes')));
}

export function createUpdatePopup({ onUpdateChange, updateState, startDownload, install }) {
  const shownFor = new Set();
  let modal = null;
  let body = null;

  const button = (label, onClick, kind, iconName) =>
    h('button', { type: 'button', class: `btn ${kind}`, onclick: onClick }, iconName ? icon(iconName) : null, label);

  function render() {
    const r = updateState.last;
    clear(body);
    body.append(
      h('div', { class: 'update-popup-hero' }, icon('sparkles'),
        h('p', { class: 'update-popup-lead' }, t('update-available', { version: r.latest, current: r.current || '' }))),
      h('h4', { class: 'update-popup-subtitle' }, t('update-whats-new')),
      notesView(notesForApp(r.notes)));
    const actions = h('div', { class: 'update-popup-actions' });
    switch (updateState.phase) {
      case 'downloading': {
        const percent = Math.round((updateState.progress || 0) * 100);
        actions.append(h('div', { class: 'update-popup-progress' },
          h('span', {}, t('update-downloading', { percent })),
          h('div', { class: 'update-progress', role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100' },
            h('div', { class: 'update-progress-bar', style: { width: `${percent}%` } }))));
        break;
      }
      case 'ready':
        actions.append(h('p', {}, t('update-ready', { version: r.latest })),
          button(t('update-restart'), install, 'btn-primary btn-lg', 'rotate-ccw'));
        break;
      case 'installing':
        actions.append(h('p', {}, t('update-installing')));
        break;
      case 'manual':
        actions.append(h('p', {}, t('update-manual', { version: r.latest })), button(t('close'), () => modal && modal.close(), 'btn-secondary'));
        break;
      default:
        actions.append(
          button(t('update-now'), startDownload, 'btn-primary btn-lg', 'download'),
          button(t('update-later'), () => modal && modal.close(), 'btn-secondary'));
    }
    body.append(actions);
    refreshIcons();
  }

  onUpdateChange(() => {
    const r = updateState.last;
    if (modal) { render(); return; }
    if (r && r.ok && r.available && r.latest && updateState.phase === 'idle' && !shownFor.has(r.latest)) {
      shownFor.add(r.latest);
      body = h('div', { class: 'update-popup' });
      modal = openModal({ title: t('update-available-short', { version: r.latest }), body, wide: true, className: 'update-popup-modal', onClose: () => { modal = null; } });
      render();
    }
  });
}
