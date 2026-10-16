// The Features screen: every feature of the app in one line, with its
// description opened in place and a button to the place where it lives.
// The same list opens full screen from the More tab on the phone.

import { t } from '../i18n.js';
import { h, clear, icon, badge, emptyState, refreshIcons, openModal } from '../ui.js';
import { FEATURES, HELP_ACTIONS, SETTINGS_SECTIONS, availability, bodyBlocks, filterFeatures, groupFeatures, helpKeys } from '../help.js';
import { navigate } from '../router.js';
import { openQuickEntry } from '../modals.js';
import { openSearch } from './search.js';
import { openWhatIfModal } from './whatif.js';
import { openJournal } from './journal.js';

const HINT_KEY = 'we-budget-help-hint-done';

// What is typed, the filter and which descriptions are open. Kept here, so
// a redraw of the screen (a sync, a change elsewhere) leaves it as it was.
const state = { query: '', onlyNew: false, open: new Set() };

const ACTIONS = {
  search: (phone) => openSearch({ phone }),
  quick: () => openQuickEntry(),
  whatif: () => openWhatIfModal(),
  journal: () => openJournal()
};

// The name on the "Open" button: the dialog, the Settings section or the
// screen on the computer; the dialog or the tab on the phone.
function placeName(feature, phone) {
  if (phone) return feature.phoneAction ? t(HELP_ACTIONS[feature.phoneAction]) : t(`help-tab-${feature.phone}`);
  if (feature.action) return t(HELP_ACTIONS[feature.action]);
  if (feature.view === 'settings' && feature.section) return `${t('nav-settings')}, ${t(SETTINGS_SECTIONS[feature.section])}`;
  return t(`nav-${feature.view}`);
}

function canOpen(feature, phone) {
  return phone ? Boolean(feature.phone) : availability(feature) !== 'phone';
}

function scrollToSection(section) {
  const el = document.querySelector(`#view-settings [data-section="${section}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// On the computer: switch the screen by its hash, then, once it is drawn,
// scroll to the Settings section or open the feature's dialog.
export function openFeatureOnDesktop(feature) {
  navigate(feature.view);
  setTimeout(() => {
    if (feature.section) scrollToSection(feature.section);
    if (feature.action) ACTIONS[feature.action](false);
  }, 60);
}

export function runPhoneAction(feature) {
  if (feature.phoneAction) ACTIONS[feature.phoneAction](true);
}

function bodyContent(text) {
  return bodyBlocks(text).map(b => (b.type === 'p'
    ? h('p', {}, b.text)
    : h(b.type, {}, b.items.map(item => h('li', {}, item)))));
}

function whereBadge(feature, phone) {
  const where = availability(feature);
  if (phone && where === 'desktop') return badge(t('help-badge-desktop'), 'help-badge-where');
  if (!phone && where === 'phone') return badge(t('help-badge-phone'), 'help-badge-where');
  return null;
}

// One feature: a button that opens and closes the description below it.
// Opening changes only this item, so focus and scroll stay where they are.
function featureItem(feature, { phone, onGo }) {
  const k = helpKeys(feature.id);
  const bodyId = `help-body-${phone ? 'p-' : ''}${feature.id}`;
  const isOpen = state.open.has(feature.id);
  const body = h('div', { id: bodyId, class: 'help-body', hidden: !isOpen },
    bodyContent(t(k.body)),
    canOpen(feature, phone)
      ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm help-go', onclick: () => onGo(feature) },
        icon('arrow-right'), t('help-open', { screen: placeName(feature, phone) }))
      : null);
  const item = h('div', { class: `help-item ${isOpen ? 'is-open' : ''}` });
  const toggle = h('button', {
    type: 'button', class: 'help-row', 'aria-expanded': isOpen ? 'true' : 'false', 'aria-controls': bodyId,
    onclick: () => {
      const open = !state.open.has(feature.id);
      if (open) state.open.add(feature.id);
      else state.open.delete(feature.id);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      body.hidden = !open;
      item.classList.toggle('is-open', open);
    }
  },
  h('span', { class: 'help-row-icon' }, icon(feature.icon)),
  h('span', { class: 'help-row-text' },
    h('span', { class: 'help-row-title' }, h('span', {}, t(k.title)),
      feature.isNew ? badge(t('help-badge-new'), 'help-badge-new') : null,
      whereBadge(feature, phone)),
    h('span', { class: 'help-row-short' }, t(k.short))),
  icon('chevron-down', 'help-row-chevron'));
  item.append(toggle, body);
  return item;
}

function renderList(list, opts) {
  clear(list);
  const found = filterFeatures(FEATURES, state, t);
  if (state.query.trim() || state.onlyNew) list.appendChild(h('p', { class: 'muted small help-found' }, t('help-found', { n: found.length })));
  if (!found.length) {
    list.appendChild(emptyState(t('help-none'), 'search'));
  } else {
    groupFeatures(found).forEach(({ group, features }) => {
      list.appendChild(h('section', { class: 'help-group' },
        h('h2', { class: 'help-group-title' }, t(`help-group-${group}`)),
        h('div', { class: 'help-items' }, features.map(f => featureItem(f, opts)))));
    });
  }
  refreshIcons();
}

// The intro, the search field, the All / What is new switch and the list.
export function helpGuide({ phone = false, onGo }) {
  const opts = { phone, onGo };
  const list = h('div', { class: 'help-list' });
  const input = h('input', {
    type: 'text', inputmode: 'search', class: 'search-input help-search-input', value: state.query,
    placeholder: t('help-search-placeholder'), 'aria-label': t('help-search-placeholder'),
    autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search'
  });
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = input.value; renderList(list, opts); }, 120);
  });
  const filterBtn = (onlyNew, label, iconName) => h('button', {
    type: 'button', class: `help-filter ${state.onlyNew === onlyNew ? 'is-on' : ''}`, 'aria-pressed': state.onlyNew === onlyNew ? 'true' : 'false',
    onclick: () => {
      state.onlyNew = onlyNew;
      filters.querySelectorAll('.help-filter').forEach((b, i) => {
        const on = (i === 1) === onlyNew;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderList(list, opts);
    }
  }, iconName ? icon(iconName) : null, label);
  const filters = h('div', { class: 'help-filters', role: 'group' },
    filterBtn(false, t('help-filter-all')),
    filterBtn(true, t('help-filter-new'), 'sparkles'));
  renderList(list, opts);
  return h('div', { class: `help-guide ${phone ? 'is-phone' : ''}` },
    h('p', { class: 'help-intro' }, t('help-intro')),
    h('div', { class: 'help-bar' }, h('div', { class: 'search-field help-search' }, icon('search'), input), filters),
    list);
}

export function renderHelp(root) {
  clear(root);
  root.appendChild(h('div', { class: 'view-header' },
    h('div', {}, h('h1', { class: 'view-title' }, t('nav-help')), h('p', { class: 'view-subtitle' }, t('help-subtitle')))));
  root.appendChild(helpGuide({ onGo: openFeatureOnDesktop }));
  refreshIcons();
}

// On the phone: the same list full screen; "Open" closes it first.
export function openHelpModal(onGo) {
  let modal = null;
  const body = helpGuide({ phone: true, onGo: (feature) => { if (modal) modal.close(); onGo(feature); } });
  modal = openModal({ title: t('nav-help'), body, wide: true, className: 'help-modal' });
  return modal;
}

// ---------- the one-time hint on the overview and the Today tab ----------

function hintDone() {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch (e) { return false; }
}

function markHintDone() {
  try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* the hint just shows again next time */ }
}

// A small line that leads to Features. A click on it or on the cross hides
// it for good on this device.
export function helpHint(onOpen) {
  if (hintDone()) return null;
  const el = h('div', { class: 'help-hint' });
  el.append(
    h('button', { type: 'button', class: 'help-hint-open', onclick: () => { markHintDone(); el.remove(); onOpen(); } },
      icon('lightbulb'), h('span', {}, t('help-hint'))),
    h('button', {
      type: 'button', class: 'help-hint-close', 'aria-label': t('help-hint-close'), title: t('help-hint-close'),
      onclick: () => { markHintDone(); el.remove(); }
    }, icon('x')));
  return el;
}
