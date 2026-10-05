// Small DOM helpers shared by all views. User text only ever reaches the
// page through textContent (h() never sets innerHTML from data).

import { store } from './store.js';
import { formatMoney, parseMoney, centsToInput } from './money.js';
import { t } from './i18n.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') el.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected') el[key] = !!value;
    else el.setAttribute(key, value === true ? '' : value);
  });
  append(el, children);
  return el;
}

function append(el, children) {
  children.flat(Infinity).forEach(child => {
    if (child === null || child === undefined || child === false) return;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  });
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function icon(name, cls = '') {
  return h('i', { 'data-lucide': name, class: cls });
}

export function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

export function lang() {
  return store.settings.language || 'ru';
}

export function money(cents, opts = {}) {
  return formatMoney(cents, { currency: store.settings.currency, lang: lang(), ...opts });
}

export function moneyEl(cents, { signed = false, cls = '', colored = false } = {}) {
  let c = 'money ' + cls;
  if (colored && cents < 0) c += ' negative';
  if (colored && cents > 0) c += ' positive';
  return h('span', { class: c.trim() }, money(cents, { signed }));
}

export function moneyInput({ value = null, placeholder = '0,00', id = null, autofocus = false } = {}) {
  const input = h('input', {
    type: 'text', inputmode: 'decimal', class: 'money-input', id,
    placeholder, value: value === null ? '' : centsToInput(value, lang()), autocomplete: 'off'
  });
  if (autofocus) setTimeout(() => input.focus(), 30);
  input.readCents = () => parseMoney(input.value);
  return input;
}

export function field(label, control, hint = null) {
  return h('div', { class: 'form-group' },
    h('label', {}, label),
    control,
    hint ? h('div', { class: 'field-hint' }, hint) : null);
}

export function selectEl(options, value = null, attrs = {}) {
  const sel = h('select', attrs);
  options.forEach(o => {
    if (o.group) {
      const g = h('optgroup', { label: o.group });
      o.options.forEach(opt => g.appendChild(h('option', { value: opt.value, selected: opt.value === value }, opt.label)));
      sel.appendChild(g);
    } else {
      sel.appendChild(h('option', { value: o.value, selected: o.value === value, disabled: o.disabled }, o.label));
    }
  });
  if (value !== null && value !== undefined) sel.value = value;
  return sel;
}

// Accounts as a flat list with envelopes indented under their account.
export function accountOptions({ includeArchived = false, emptyLabel = null } = {}) {
  const accounts = store.list('accounts').filter(a => includeArchived || !a.archived);
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
  const tops = accounts.filter(a => !a.parentId || !accounts.some(p => p.id === a.parentId)).sort(byOrder);
  const opts = emptyLabel !== null ? [{ value: '', label: emptyLabel }] : [];
  tops.forEach(top => {
    opts.push({ value: top.id, label: top.name });
    accounts.filter(a => a.parentId === top.id).sort(byOrder)
      .forEach(child => opts.push({ value: child.id, label: `${top.name} / ${child.name}` }));
  });
  return opts;
}

export function accountLabel(id) {
  const a = store.find('accounts', id) || (store.data.accounts || []).find(x => x.id === id);
  if (!a) return '';
  const parent = a.parentId ? (store.data.accounts || []).find(x => x.id === a.parentId) : null;
  return parent ? `${parent.name} / ${a.name}` : a.name;
}

export function categoryOptions(type, { emptyLabel = null } = {}) {
  const cats = store.list('categories')
    .filter(c => c.type === type && !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name, lang()));
  const opts = emptyLabel !== null ? [{ value: '', label: emptyLabel }] : [];
  return opts.concat(cats.map(c => ({ value: c.id, label: c.name })));
}

export function categoryName(id) {
  const c = (store.data.categories || []).find(x => x.id === id);
  return c ? c.name : '';
}

// ---------- modals ----------

let modalStack = [];

export function openModal({ title, body, actions = [], wide = false, onClose = null, className = '' }) {
  const overlay = h('div', { class: 'modal-overlay active' });
  const content = h('div', { class: `modal-content ${wide ? 'modal-wide' : ''} ${className}`.trim(), role: 'dialog', 'aria-modal': 'true' });
  const close = () => {
    overlay.remove();
    modalStack = modalStack.filter(m => m !== api);
    if (onClose) onClose();
  };
  const header = h('div', { class: 'modal-header' },
    h('h3', { class: 'modal-title' }, title),
    h('button', { class: 'modal-close', type: 'button', 'aria-label': t('close'), onclick: close }, icon('x')));
  const footer = h('div', { class: 'modal-actions' });
  actions.forEach(a => {
    const btn = h('button', {
      type: 'button',
      class: `btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-secondary'}`,
      onclick: () => a.onClick(api)
    }, a.label);
    if (a.kind === 'primary') btn.dataset.primary = '1';
    footer.appendChild(btn);
  });
  // append() would print a literal "null", so the footer is added only
  // when there are buttons.
  content.append(header, h('div', { class: 'modal-body' }, body));
  if (actions.length) content.append(footer);
  overlay.appendChild(content);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  const api = { close, overlay, content, footer };
  modalStack.push(api);
  refreshIcons();
  const first = content.querySelector('[autofocus], input, select, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return api;
}

export function topModal() {
  return modalStack[modalStack.length - 1] || null;
}

export function initModalKeys() {
  document.addEventListener('keydown', (e) => {
    const m = topModal();
    if (!m) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      m.close();
    } else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      const primary = m.footer.querySelector('[data-primary]');
      if (primary) {
        e.preventDefault();
        primary.click();
      }
    }
  }, true);
}

export function confirmDialog(message, { okLabel = null, danger = false, title = null } = {}) {
  return new Promise(resolve => {
    let answered = false;
    openModal({
      title: title || t('confirm-title'),
      body: h('p', { class: 'confirm-text' }, message),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: t('cancel'), onClick: (m) => m.close() },
        { label: okLabel || t('ok'), kind: danger ? 'danger' : 'primary', onClick: (m) => { answered = true; resolve(true); m.close(); } }
      ]
    });
  });
}

export function emptyState(text, iconName = 'inbox') {
  return h('div', { class: 'empty-state' }, icon(iconName), h('p', {}, text));
}

export function badge(text, cls = '') {
  return h('span', { class: `badge ${cls}`.trim() }, text);
}

export function download(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(file, 'utf-8');
    });
    document.body.appendChild(input);
    input.click();
  });
}
