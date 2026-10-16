// Encryption of the budget file in Google Drive: the rows in Settings > Sync
// and the password dialogs. The work itself is in the sync engine
// (src/sync/engine.js) and the crypto module (src/sync/crypto.js).

import { t } from '../i18n.js';
import { showToast } from '../toast.js';
import { h, icon, field, openModal, confirmDialog } from '../ui.js';
import { sync } from '../cloud.js';
import { MIN_PASSWORD, passwordStrength } from '../sync/crypto.js';

function passwordInput(autocomplete, autofocus = false) {
  // 16px on touch screens comes from the shared input rule in style.css.
  return h('input', { type: 'password', autocomplete, autocapitalize: 'off', spellcheck: 'false', autofocus: autofocus ? 'autofocus' : null });
}

function showToggle(inputs) {
  const box = h('input', { type: 'checkbox' });
  box.addEventListener('change', () => inputs.forEach(i => { i.type = box.checked ? 'text' : 'password'; }));
  return h('label', { class: 'checkbox-row' }, box, h('span', {}, t('enc-show-password')));
}

const STRENGTH = ['enc-strength-short', 'enc-strength-weak', 'enc-strength-fair', 'enc-strength-strong'];

// The live hint under a new password.
function strengthHint(input) {
  const el = h('div', { class: 'field-hint enc-strength', 'aria-live': 'polite' });
  const render = () => {
    const score = passwordStrength(input.value);
    el.textContent = input.value ? t(STRENGTH[score], { n: MIN_PASSWORD }) : t('enc-min-length', { n: MIN_PASSWORD });
    el.dataset.score = input.value ? String(score) : '';
  };
  input.addEventListener('input', render);
  render();
  return el;
}

function errorLine() {
  return h('p', { class: 'enc-error', role: 'alert', hidden: true });
}

// The line sits under the fields; on a small screen it may be out of view.
function setError(el, text) {
  el.textContent = text || '';
  el.hidden = !text;
  if (text && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
}

// A dialog whose primary button runs `submit` once; deriving the key takes a
// moment (on purpose), so the button says so meanwhile. `submit` returns an
// error text to show, or nothing to close the dialog.
function passwordDialog({ title, body, okLabel, danger = false, submit }) {
  const error = errorLine();
  let busy = false;
  const modal = openModal({
    title,
    className: 'enc-dialog',
    body: h('div', {}, ...body, error),
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: okLabel,
        kind: danger ? 'danger' : 'primary',
        onClick: async (m) => {
          if (busy) return;
          const btn = m.footer.querySelector(danger ? '.btn-danger' : '[data-primary]');
          busy = true;
          setError(error, '');
          if (btn) { btn.disabled = true; btn.textContent = t('enc-working'); }
          let message;
          try {
            message = await submit();
          } catch (e) {
            console.error(e);
            message = t('enc-failed');
          }
          busy = false;
          if (btn) { btn.disabled = false; btn.textContent = okLabel; }
          if (message) setError(error, message);
          else m.close();
        }
      }
    ]
  });
  return modal;
}

function newPasswordError(a, b) {
  if (a.value.length < MIN_PASSWORD) return t('enc-too-short', { n: MIN_PASSWORD });
  if (a.value !== b.value) return t('enc-mismatch');
  return null;
}

// What a finished request means for the person.
function reportResult(result, doneKey) {
  if (result.synced && !result.synced.ok) {
    showToast(t('enc-next-sync'), { type: 'info', duration: 8000 });
  } else {
    showToast(t(doneKey), { type: 'success', duration: 6000 });
  }
  if (result.stored === false) showToast(t('enc-session-only'), { type: 'info', duration: 8000 });
}

function errorText(code) {
  if (code === 'wrong_password') return t('enc-wrong-password');
  if (code === 'short') return t('enc-too-short', { n: MIN_PASSWORD });
  if (code === 'damaged') return t('enc-damaged');
  if (code === 'newer_format') return t('enc-newer-format');
  if (code === 'locked') return t('enc-locked-first');
  return t('enc-failed');
}

// Asked when the cloud file is encrypted and this device cannot open it.
export function promptUnlock() {
  const pass = passwordInput('current-password', true);
  passwordDialog({
    title: t('enc-unlock-title'),
    okLabel: t('enc-unlock'),
    body: [
      h('p', { class: 'confirm-text' }, t(sync.state.lockReason === 'changed' ? 'enc-unlock-changed' : 'enc-unlock-text')),
      field(t('enc-password'), pass),
      showToggle([pass])
    ],
    submit: async () => {
      if (!pass.value) return t('enc-wrong-password');
      const result = await sync.unlock(pass.value);
      if (!result.ok) return result.offline ? t('sync-offline') : errorText(result.error);
      showToast(t('enc-unlocked'), { type: 'success', duration: 6000 });
      if (result.stored === false) showToast(t('enc-session-only'), { type: 'info', duration: 8000 });
      return null;
    }
  });
}

function enableDialog() {
  const a = passwordInput('new-password', true);
  const b = passwordInput('new-password');
  passwordDialog({
    title: t('enc-enable-title'),
    okLabel: t('enc-enable'),
    body: [
      h('div', { class: 'enc-warning' }, icon('alert-triangle'), h('div', {},
        h('p', {}, h('strong', {}, t('enc-warn-recover'))),
        h('p', {}, t('enc-warn-devices')),
        h('p', {}, t('enc-warn-update')))),
      field(t('enc-new-password'), a, strengthHint(a)),
      field(t('enc-repeat-password'), b),
      showToggle([a, b])
    ],
    submit: async () => {
      const bad = newPasswordError(a, b);
      if (bad) return bad;
      const result = await sync.enableEncryption(a.value);
      if (!result.ok && !result.synced) return errorText(result.error);
      reportResult(result, 'enc-enabled');
      return null;
    }
  });
}

function changeDialog() {
  const old = passwordInput('current-password', true);
  const a = passwordInput('new-password');
  const b = passwordInput('new-password');
  passwordDialog({
    title: t('enc-change-title'),
    okLabel: t('enc-change'),
    body: [
      h('p', { class: 'confirm-text' }, t('enc-change-text')),
      field(t('enc-current-password'), old),
      field(t('enc-new-password'), a, strengthHint(a)),
      field(t('enc-repeat-password'), b),
      showToggle([old, a, b])
    ],
    submit: async () => {
      const bad = newPasswordError(a, b);
      if (bad) return bad;
      const result = await sync.changePassword(old.value, a.value);
      if (!result.ok && !result.synced) return errorText(result.error);
      reportResult(result, 'enc-changed');
      return null;
    }
  });
}

function disableDialog() {
  const pass = passwordInput('current-password', true);
  passwordDialog({
    title: t('enc-disable-title'),
    okLabel: t('enc-disable'),
    danger: true,
    body: [
      h('p', { class: 'confirm-text' }, t('enc-disable-text')),
      field(t('enc-password'), pass),
      showToggle([pass])
    ],
    submit: async () => {
      const result = await sync.disableEncryption(pass.value);
      if (!result.ok && !result.synced) return errorText(result.error);
      reportResult(result, 'enc-disabled');
      return null;
    }
  });
}

async function forgetPassword() {
  const ok = await confirmDialog(t('enc-forget-confirm'), { okLabel: t('enc-forget'), danger: true });
  if (!ok) return;
  await sync.forgetPassword();
  showToast(t('enc-forgotten'), { type: 'info' });
}

// Rows for the Sync section while signed in. `settingRow` and
// `checkboxLabel` come from settings.js to keep the look the same.
export function encryptionRows({ settingRow, checkboxLabel }) {
  const st = sync.state;
  const rows = [];
  if (st.locked) {
    rows.push(settingRow(t('enc-title'), h('span', { class: 'setting-value sync-text-reauth' }, t('sync-locked')),
      t(st.lockReason === 'changed' ? 'enc-unlock-changed' : 'enc-unlock-text')));
    rows.push(h('div', { class: 'inline-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: promptUnlock }, icon('key-round'), t('enc-unlock-button'))));
    return rows;
  }
  const settingUp = Boolean(sync.vault.next);
  const on = (st.encrypted && !st.turningOff) || settingUp;
  const box = h('input', { type: 'checkbox', checked: on, disabled: st.status === 'syncing' });
  box.addEventListener('change', () => {
    // The box shows the state, the dialog changes it.
    box.checked = on;
    if (on) disableDialog();
    else enableDialog();
  });
  let hint = t('enc-hint');
  if (settingUp || st.turningOff) hint = t('enc-pending');
  else if (on) hint = t(st.keyStored ? 'enc-on-stored' : 'enc-on-session');
  rows.push(settingRow(t('enc-title'), checkboxLabel(box, t('enc-setting')), hint));
  if (on && !settingUp) {
    rows.push(h('div', { class: 'inline-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', disabled: st.status === 'syncing', onclick: changeDialog }, icon('key-round'), t('enc-change-button')),
      h('button', { type: 'button', class: 'btn btn-secondary', disabled: st.status === 'syncing', onclick: forgetPassword }, icon('lock'), t('enc-forget'))));
  }
  return rows;
}
