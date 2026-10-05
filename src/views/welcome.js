// First run: start from scratch, restore a file, or look at the demo.

import { store } from '../store.js';
import { t } from '../i18n.js';
import { showToast } from '../toast.js';
import { h, clear, icon, refreshIcons, lang, moneyInput, selectEl, pickFile } from '../ui.js';
import { todayKey, isDayKey } from '../dates.js';
import { buildDemo } from '../demo.js';
import { navigate } from '../router.js';
import { sync, signIn, cancelSignIn } from '../cloud.js';
import { hasAnyData } from '../model.js';

function accountLine(removable, onRemove) {
  const name = h('input', { type: 'text', placeholder: t('welcome-account-name') });
  const balance = moneyInput({ placeholder: t('welcome-account-balance') });
  const line = h('div', { class: 'welcome-account' }, name, balance,
    removable ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('delete'), onclick: () => onRemove(line) }, icon('x')) : h('span', { class: 'reserve-spacer' }));
  line.read = () => ({ name: name.value.trim(), openingBalance: balance.readCents() });
  return line;
}

export function renderWelcome(root) {
  clear(root);
  const language = selectEl([{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }], lang());
  language.addEventListener('change', () => store.updateSettings({ language: language.value }));

  const lines = h('div', { class: 'welcome-accounts' });
  const addLine = (removable) => {
    const line = accountLine(removable, (l) => { l.remove(); refreshIcons(); });
    lines.appendChild(line);
    refreshIcons();
  };
  addLine(false);
  const start = h('input', { type: 'date', value: todayKey() });

  const fresh = h('div', { class: 'card welcome-card' },
    h('div', { class: 'card-title-row' }, icon('sparkle'), h('h3', {}, t('welcome-fresh'))),
    h('p', { class: 'setting-hint' }, t('welcome-fresh-hint')),
    lines,
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => addLine(true) }, icon('plus'), t('welcome-add-account')),
    h('div', { class: 'form-group' }, h('label', {}, t('settings-tracking')), start, h('div', { class: 'field-hint' }, t('welcome-start-hint'))),
    h('button', {
      type: 'button', class: 'btn btn-primary', onclick: () => {
        const accounts = [...lines.children].map(l => l.read()).filter(a => a.name);
        if (!accounts.length) { showToast(t('welcome-need-account'), { type: 'error' }); return; }
        if (accounts.some(a => a.openingBalance === null && a.name)) {
          accounts.forEach(a => { if (a.openingBalance === null) a.openingBalance = 0; });
        }
        if (!isDayKey(start.value)) { showToast(t('err-date'), { type: 'error' }); return; }
        store.setupFresh({ language: lang(), accounts, trackingStart: start.value });
        navigate('templates');
      }
    }, t('welcome-start')));

  // On a second computer the budget is already in the cloud: sign in and
  // it comes down.
  const canSync = sync.bridge && !['unavailable', 'unconfigured'].includes(sync.state.status);
  const cloudCard = canSync ? h('div', { class: 'card welcome-card welcome-cloud' },
    h('div', { class: 'card-title-row' }, icon('cloud'), h('h3', {}, t('welcome-cloud'))),
    h('p', { class: 'setting-hint' }, t('welcome-cloud-hint')),
    sync.state.signingIn
      ? h('div', { class: 'inline-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, icon('loader'), t('sync-waiting-browser')),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: cancelSignIn }, t('cancel')))
      : h('button', {
        type: 'button', class: 'btn btn-primary', onclick: async () => {
          const ok = await signIn();
          if (!ok) return;
          if (hasAnyData(store.data)) navigate('month');
          else showToast(t('welcome-cloud-empty'), { type: 'info', duration: 8000 });
        }
      }, icon('log-in'), t('sync-login'))) : null;

  const restore = h('div', { class: 'card welcome-card' },
    h('div', { class: 'card-title-row' }, icon('upload'), h('h3', {}, t('welcome-restore'))),
    h('p', { class: 'setting-hint' }, t('welcome-restore-hint')),
    h('button', {
      type: 'button', class: 'btn btn-secondary', onclick: async () => {
        const file = await pickFile('.json,application/json');
        if (!file) return;
        try {
          const parsed = JSON.parse(file.text);
          if (!parsed || !Array.isArray(parsed.entries) || !parsed.settings) throw new Error('shape');
          store.replaceAll(parsed);
          store.generate();
          navigate('month');
        } catch (e) {
          showToast(t('err-file'), { type: 'error' });
        }
      }
    }, icon('folder-open'), t('welcome-restore-btn')));

  const demo = h('div', { class: 'card welcome-card' },
    h('div', { class: 'card-title-row' }, icon('eye'), h('h3', {}, t('welcome-demo'))),
    h('p', { class: 'setting-hint' }, t('welcome-demo-hint')),
    h('button', {
      type: 'button', class: 'btn btn-secondary', onclick: () => {
        store.replaceAll(buildDemo(todayKey(), lang()));
        navigate('overview');
      }
    }, icon('sparkles'), t('demo-load-btn')));

  root.appendChild(h('div', { class: 'welcome' },
    h('div', { class: 'welcome-head' },
      h('h1', { class: 'view-title' }, t('welcome-title')),
      h('p', { class: 'view-subtitle' }, t('welcome-subtitle')),
      h('div', { class: 'welcome-lang' }, icon('languages'), language)),
    h('div', { class: 'welcome-grid' }, fresh, h('div', { class: 'welcome-side' }, cloudCard, restore, demo))));
  refreshIcons();
}
