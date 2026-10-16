// Sync between devices through one file in the user's cloud storage.
//
// The engine runs in the page. The transport (sign-in, download, upload) is
// a bridge object: the Electron preload on the desktop, the browser's own
// OAuth on the phone. The bridge only moves text; all merging happens here,
// so every device follows the same rules.
//
// Rules, so that a device with old data never overwrites newer work:
//   - On launch, after signing in and in the background the app only takes
//     data from the cloud. Uploads happen only when the window closes, when
//     the app quits and from the Sync button.
//   - Whether the cloud changed is decided by its content: the hash of the
//     cloud file against the hash this device saw at its last sync. The same
//     data uploaded again moves the file's version, but is no change.
//   - Every upload looks at the cloud first and never replaces content this
//     device has not seen. Unchanged data is not uploaded at all.
//   - When both copies changed (or this device has no record of the cloud
//     file: another OAuth client, a sign-out), they are merged record by
//     record without asking anyone, and both originals are kept as backups.
//
// Encryption (optional, see crypto.js and vault.js). The engine encrypts
// right before an upload and decrypts right after a download; everything in
// between, hashes included, works on the budget JSON itself. So a fresh IV
// never looks like a change, and an unchanged budget is not uploaded again.
//   - The encrypted file has a name of its own (we-budget-data.enc.gz).
//     Versions 1.1.5 and older only look for the plain name. Had the
//     envelope kept that name, they would have parsed it as a budget (it is
//     valid JSON), found no records in it and merged their own data over it
//     on closing: the encrypted budget would be gone from the cloud. Under
//     the new name they do not see it at all and can only write a plain file
//     of their own, which this engine treats like a spare copy: merged in,
//     then removed once the encrypted file holds everything.
//   - Whether the account is encrypted is decided by the cloud file. A
//     device that cannot open it (no password, or one changed elsewhere)
//     stops: it reads, merges and writes nothing until the password is typed.
//   - Turning encryption on or off and changing the password are uploads
//     like any other (look at the cloud, merge, write over the file seen);
//     a switch renames the same file, so there is never a second copy.

import { COLLECTIONS } from '../model.js';

// Anything recorded here, deletions included: a reset is work too.
function hasRecords(data) {
  return COLLECTIONS.some(name => (data[name] || []).length > 0);
}
import { mergeBudgets } from './merge.js';
import { hashString } from './hash.js';
import { envelopeOf, encryptText, decryptEnvelope, unlockEnvelope, keyFromPassword, MIN_PASSWORD } from './crypto.js';
import { Vault } from './vault.js';

// 'renew': the web app's hour of access is over; a tap renews it.
// 'locked': the cloud file is encrypted and this device has no key for it.
export const SYNC_STATUSES = ['unavailable', 'unconfigured', 'checking', 'off', 'idle', 'syncing', 'offline', 'renew', 'reauth', 'locked', 'error'];

function lockedError(reason) {
  const err = new Error('locked');
  err.locked = true;
  err.lockReason = reason;
  return err;
}

// What a sync does, from what is known about both copies.
//   remoteExists   the cloud holds a budget file
//   known          this device remembers the cloud file and its content at
//                  its last sync (no: another OAuth client, a sign-out, an
//                  older version of the app)
//   remoteChanged  the cloud CONTENT differs from what this device last saw
//   localChanged   the local budget differs from what it was at that sync
//   localWork      the local budget holds anything at all
// Returns 'push', 'pull', 'merge' or 'up_to_date'. 'merge' means both sides
// hold work the other has not seen; then they are combined, so no copy ever
// replaces the other.
export function syncAction({ remoteExists, known, remoteChanged, localChanged, localWork }) {
  if (!remoteExists) return localWork ? 'push' : 'up_to_date';
  if (!known) return localWork ? 'merge' : 'pull';
  if (remoteChanged && localChanged) return 'merge';
  if (remoteChanged) return 'pull';
  if (localChanged) return 'push';
  return 'up_to_date';
}

export class SyncEngine {
  // `keepCopy(tag, json)` stores a copy of a budget in the backups (both
  // originals of a merge); optional.
  constructor({ store, bridge, keepCopy = null, afterApply = null, intervalMs = 5 * 60 * 1000, vault = null }) {
    this.store = store;
    this.bridge = bridge;
    this.vault = vault || new Vault();
    this.keepCopy = keepCopy;
    this.afterApply = afterApply;
    this.intervalMs = intervalMs;
    this.loggedIn = false;
    this.running = null;
    this.again = null;
    this.applying = false;
    this.listeners = [];
    // encrypted: the cloud file is encrypted (as last seen); locked: it is,
    // and this device cannot open it; keyStored: the key survives a restart.
    this.state = {
      status: bridge ? 'checking' : 'unavailable', email: '', lastSyncAt: null, error: null, reauthReason: null, pending: false,
      encrypted: false, locked: false, lockReason: null, keyStored: true, turningOff: false
    };
  }

  onChange(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => { try { fn(this.state); } catch (e) { console.error(e); } });
  }

  // Every bridge call returns { ok, ... }; failures become exceptions that
  // carry what kind of failure it was.
  async call(method, ...args) {
    const result = await this.bridge[method](...args);
    if (!result || result.ok === false) {
      const err = new Error((result && result.error) || `${method} failed`);
      err.reauth = Boolean(result && result.reauth);
      err.reason = (result && result.reason) || null;
      err.renew = Boolean(result && result.renew);
      err.offline = Boolean(result && result.offline);
      throw err;
    }
    return result;
  }

  // Launch: takes what the cloud has, uploads nothing.
  async init({ auto = true, reason = 'startup' } = {}) {
    if (!this.bridge) return;
    const status = await this.bridge.status();
    if (!status.configured) {
      this.setState({ status: 'unconfigured' });
      return;
    }
    const saved = await this.bridge.getState();
    await this.vault.load();
    this.loggedIn = Boolean(status.loggedIn);
    // Signed out because Google dropped the sign-in, not by choice: keep
    // asking, a restart must not turn a stopped sync into a quiet one.
    const pending = this.loggedIn ? null : status.signInNeeded || null;
    this.setState({
      status: this.loggedIn ? 'idle' : pending ? 'reauth' : 'off',
      reauthReason: pending ? pending.reason || 'expired' : null,
      email: status.email || (pending && pending.email) || '',
      lastSyncAt: (saved && saved.lastSyncAt) || null,
      encrypted: Boolean(saved && saved.encrypted),
      turningOff: Boolean(saved && saved.intent === 'decrypt'),
      keyStored: this.vault.stored
    });
    if (auto) this.startAuto();
    if (this.loggedIn) await this.sync(reason);
  }

  // While the app is open it keeps taking what other devices uploaded.
  // Its own changes wait for closing or the Sync button.
  startAuto() {
    this.store.subscribe(() => {
      if (!this.applying && this.loggedIn && !this.state.pending) this.setState({ pending: true });
    });
    setInterval(() => this.sync('interval'), this.intervalMs);
    if (typeof window !== 'undefined' && window.addEventListener) {
      let lastFocus = 0;
      window.addEventListener('focus', () => {
        if (Date.now() - lastFocus < 60 * 1000) return;
        lastFocus = Date.now();
        this.sync('focus');
      });
      window.addEventListener('online', () => this.sync('online'));
    }
  }

  // Sign-in: like a launch, it only takes data from the cloud.
  async login(lang) {
    const result = await this.bridge.login(lang);
    if (!result || !result.ok) return result || { ok: false };
    this.loggedIn = true;
    this.setState({ status: 'idle', email: result.email || '', error: null, reauthReason: null });
    const synced = await this.sync('login');
    return { ok: true, synced };
  }

  // The key goes too: another account signed in later has its own file.
  async logout() {
    await this.bridge.logout();
    await this.bridge.setState({
      fileId: null, version: null, remoteHash: null, localHash: null, lastSyncAt: null,
      encrypted: null, remoteSalt: null, remoteIterations: null, intent: null
    });
    await this.vault.forget();
    this.loggedIn = false;
    this.setState({ status: 'off', email: '', lastSyncAt: null, error: null, reauthReason: null, pending: false, encrypted: false, locked: false, lockReason: null });
  }

  json() {
    return JSON.stringify(this.store.data);
  }

  // Whether the budget changed here since the last sync.
  isDirty(saved) {
    return hashString(this.json()) !== (saved && saved.localHash);
  }

  // Encryption turned on, off or a new password set here and not yet in the
  // cloud: the next upload carries it even when the budget is unchanged.
  modeChangePending(saved) {
    return Boolean(this.vault.next) || Boolean(saved && saved.intent === 'decrypt');
  }

  // Closing the window or quitting: the only automatic upload. Unchanged
  // data is not uploaded at all; changed data goes up only after a look at
  // the cloud (see cycle).
  async flush() {
    if (!this.loggedIn) return { ok: true, outcome: 'off' };
    if (this.running) await this.running;
    const saved = await this.bridge.getState();
    if (!this.isDirty(saved) && !this.modeChangePending(saved)) return { ok: true, outcome: 'clean' };
    return this.sync('close', { upload: true });
  }

  // `upload` only for closing, quitting and the Sync button ('manual').
  sync(reason = 'manual', { upload = reason === 'manual' } = {}) {
    if (!this.loggedIn) return Promise.resolve({ ok: false, outcome: 'off' });
    if (this.running) {
      // A request that may upload is not swallowed by a pull already
      // running: it runs right after it.
      if (upload) {
        this.again = { reason, upload };
        return this.running.then(() => this.sync(reason, { upload }));
      }
      return this.running;
    }
    this.running = this.cycle(reason, { upload }).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  apply(data) {
    this.applying = true;
    try {
      this.store.applySynced(data);
    } finally {
      this.applying = false;
    }
    if (this.afterApply) {
      this.applying = true;
      try { this.afterApply(); } finally { this.applying = false; }
    }
  }

  async remember(patch) {
    await this.bridge.setState(patch);
  }

  // Uploads `text` over the file this device just looked at. Right before
  // writing, the cloud is asked again: if another device wrote in the
  // meantime, nothing is written and the cycle starts over.
  // `mode.entry` is the key to seal with; without it the text goes up plain.
  // The hashes are always those of the budget JSON, never of the envelope.
  async uploadOver(fileId, version, text, mode = { entry: null }) {
    if (fileId) {
      const now = await this.call('meta');
      if (!now.exists || now.fileId !== fileId || now.version !== version) return null;
    }
    const entry = mode.entry || null;
    const content = entry ? await encryptText(text, entry) : text;
    const up = await this.call('upload', content, fileId, Boolean(entry));
    const hash = hashString(text);
    await this.remember({
      fileId: up.fileId, version: up.version, remoteHash: hash, localHash: hashString(this.json()),
      encrypted: Boolean(entry), remoteSalt: entry ? entry.salt : null, remoteIterations: entry ? entry.iterations : null,
      intent: null
    });
    if (entry && entry === this.vault.next) await this.vault.commit();
    // Off for the account now: no key is kept for a file that is not there.
    if (!entry) await this.vault.forget();
    this.setState({ encrypted: Boolean(entry), keyStored: this.vault.stored });
    return up;
  }

  // Downloads a cloud file and opens it. Returns the budget text and, for an
  // encrypted file, its key parameters. Throws a 'locked' error when this
  // device has no key for it, and 'damaged' (or 'newer_format') when the
  // file cannot be read: either way nothing is merged or written.
  async readFile(fileId) {
    const file = await this.call('download', fileId);
    const envelope = envelopeOf(file.content);
    if (!envelope) return { text: file.content, version: file.version, salt: null, iterations: null };
    const entry = this.vault.current;
    const fits = entry && entry.salt === envelope.kdf.salt && entry.iterations === envelope.kdf.iterations;
    if (!fits) throw lockedError(entry ? 'changed' : 'password');
    try {
      const text = await decryptEnvelope(envelope, entry);
      return { text, version: file.version, salt: envelope.kdf.salt, iterations: envelope.kdf.iterations };
    } catch (e) {
      if (e.code === 'wrong_password') throw lockedError('changed');
      throw e;
    }
  }

  // The cloud file cannot be opened here. A password this device meant to
  // set lost to one set elsewhere: it is dropped, not forced over the file.
  async lockDown(err) {
    await this.vault.dropNext();
    await this.remember({ intent: null });
    this.setState({ encrypted: true, turningOff: false, locked: true, lockReason: err.lockReason || 'password', keyStored: this.vault.stored });
    return err;
  }

  // ---------- encryption (Settings) ----------

  // Waits for a running sync, so a key never changes under a cycle.
  async settle() {
    if (this.running) await this.running.catch(() => null);
  }

  // The password for an encrypted cloud file. A wrong one changes nothing.
  // After a right one sync goes on by the usual rules (pull, or merge when
  // both sides changed); this device's own changes go up on closing.
  async unlock(password) {
    if (!this.loggedIn) return { ok: false, error: 'off' };
    await this.settle();
    try {
      const meta = await this.call('meta');
      if (meta.exists && meta.encrypted) {
        const file = await this.call('download', meta.fileId);
        const envelope = envelopeOf(file.content);
        if (envelope) await this.vault.setCurrent(await unlockEnvelope(envelope, password));
      }
    } catch (e) {
      return { ok: false, error: e.code || e.message, offline: Boolean(e.offline) };
    }
    this.setState({ locked: false, lockReason: null, keyStored: this.vault.stored });
    const synced = await this.sync('unlock');
    return { ok: true, synced, stored: this.vault.stored };
  }

  // Turning encryption on: the budget goes up sealed with a new key (after
  // the usual look at the cloud and merge).
  async enableEncryption(password) {
    if (!this.loggedIn) return { ok: false, error: 'off' };
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) return { ok: false, error: 'short' };
    await this.settle();
    if (this.state.locked) return { ok: false, error: 'locked' };
    await this.vault.setNext(await keyFromPassword(password));
    await this.remember({ intent: null });
    const synced = await this.sync('encrypt', { upload: true });
    return { ok: synced.ok, synced, error: synced.error || null, stored: this.vault.stored };
  }

  // A new password: the same file sealed again with a new salt and key.
  async changePassword(oldPassword, newPassword) {
    if (!this.loggedIn) return { ok: false, error: 'off' };
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) return { ok: false, error: 'short' };
    await this.settle();
    if (!(await this.vault.matches(oldPassword))) return { ok: false, error: 'wrong_password' };
    await this.vault.setNext(await keyFromPassword(newPassword));
    const synced = await this.sync('rekey', { upload: true });
    return { ok: synced.ok, synced, error: synced.error || null, stored: this.vault.stored };
  }

  // Turning encryption off: the budget goes up plain, the key is forgotten.
  async disableEncryption(password) {
    if (!this.loggedIn) return { ok: false, error: 'off' };
    await this.settle();
    if (!(await this.vault.matches(password))) return { ok: false, error: 'wrong_password' };
    await this.vault.dropNext();
    await this.remember({ intent: 'decrypt' });
    this.setState({ turningOff: true });
    const synced = await this.sync('decrypt', { upload: true });
    return { ok: synced.ok, synced, error: synced.error || null };
  }

  // This device asks for the password again; the cloud file is untouched.
  async forgetPassword() {
    await this.settle();
    await this.vault.forget();
    await this.remember({ intent: null });
    this.setState({ keyStored: true });
    return this.sync('forget');
  }

  keep(tag, text) {
    if (!this.keepCopy) return;
    try { this.keepCopy(tag, text); } catch (e) { console.error('Could not keep a copy', e); }
  }

  async cycle(reason, { upload }) {
    this.setState({ status: 'syncing' });
    try {
      let result = null;
      for (let attempt = 0; attempt < 3 && !result; attempt++) {
        result = await this.step({ upload });
      }
      if (!result) throw new Error('The cloud kept changing while uploading');
      const saved = await this.bridge.getState();
      const lastSyncAt = new Date().toISOString();
      await this.bridge.setState({ lastSyncAt });
      this.setState({
        status: 'idle', lastSyncAt, error: null, pending: this.isDirty(saved) || this.modeChangePending(saved),
        encrypted: Boolean(saved.encrypted), turningOff: saved.intent === 'decrypt',
        locked: false, lockReason: null, keyStored: this.vault.stored
      });
      return { ok: true, outcome: result, reason };
    } catch (e) {
      if (e.reauth) this.loggedIn = false;
      if (e.locked) await this.lockDown(e);
      this.setState({
        status: e.reauth ? 'reauth' : e.renew ? 'renew' : e.offline ? 'offline' : e.locked ? 'locked' : 'error',
        reauthReason: e.reauth ? e.reason || 'expired' : null,
        error: e.locked ? 'locked' : e.code || e.message
      });
      return { ok: false, error: e.locked ? 'locked' : e.code || e.message, reason };
    }
  }

  // One look at both copies and what follows from it. Returns the outcome,
  // or null when an upload found the cloud changed under it (try again).
  async step({ upload }) {
    const saved = await this.bridge.getState();
    await this.vault.load();
    const meta = await this.call('meta');
    const remoteEncrypted = Boolean(meta.exists && meta.encrypted);
    // An encrypted file this device has no key for is left alone entirely:
    // no spare copy is merged and nothing is written until the password is
    // typed.
    if (remoteEncrypted && !this.vault.current) throw lockedError('password');

    // Two devices creating the file at the same moment leave two copies, and
    // an older version of the app leaves a plain file next to an encrypted
    // one. A spare copy is merged in before it may go: it can hold work the
    // main one lacks. One this device cannot open stays where it is.
    const duplicates = (meta.exists && meta.duplicates) || [];
    const spares = [];
    for (const id of duplicates) {
      let spare;
      try {
        spare = await this.readFile(id);
      } catch (e) {
        if (e.locked || e.code) continue;
        throw e;
      }
      this.keep('cloud', spare.text);
      const { data, localChanged } = mergeBudgets(this.store.data, JSON.parse(spare.text));
      spares.push(id);
      if (localChanged) {
        this.apply(data);
        saved.localHash = null;
        await this.remember({ localHash: null });
      }
    }
    // Spare copies are removed once the main file holds everything.
    const tidy = async () => {
      if (!spares.length) return;
      try { await this.call('remove', spares); } catch (e) { /* tidy-up only */ }
    };
    const localText = this.json();
    const localHash = hashString(localText);
    const localWork = hasRecords(this.store.data);

    // How the next upload is written: sealed while the account is encrypted
    // or a new password waits here, plain once turned off (by this device or
    // by another one, which also makes this device's key useless).
    const turningOff = saved.intent === 'decrypt';
    if (meta.exists && !remoteEncrypted && !this.vault.next && this.vault.current) await this.vault.forget();
    const writeEntry = turningOff ? null : this.vault.next || this.vault.current;
    const mode = { entry: writeEntry };

    if (!meta.exists) {
      const action = syncAction({ remoteExists: false, localWork });
      if (action !== 'push') {
        // Nothing to write, so nothing to seal either: the new setting is
        // simply in force.
        await this.vault.commit();
        if (turningOff) await this.remember({ intent: null });
        return 'empty';
      }
      if (!upload) return 'local-ahead';
      return (await this.uploadOver(null, null, localText, mode)) ? 'pushed' : null;
    }

    // The version is only a shortcut: unchanged means nobody wrote. When it
    // moved, the content decides (decrypted: every upload's bytes differ).
    const known = Boolean(saved.fileId && saved.fileId === meta.fileId && saved.remoteHash);
    let remoteText = null;
    let remoteHash = known ? saved.remoteHash : null;
    let version = meta.version;
    let remoteSalt = known ? saved.remoteSalt || null : null;
    let remoteIterations = known ? saved.remoteIterations || null : null;
    const read = async () => {
      const remote = await this.readFile(meta.fileId);
      remoteText = remote.text;
      remoteHash = hashString(remoteText);
      remoteSalt = remote.salt;
      remoteIterations = remote.iterations;
      version = remote.version || version;
    };
    if (!known || meta.version !== saved.version || (remoteEncrypted && !saved.remoteSalt)) await read();
    const encryptedNow = Boolean(remoteSalt);
    if (turningOff && !encryptedNow) await this.remember({ intent: null });
    const where = { fileId: meta.fileId, encrypted: encryptedNow, remoteSalt, remoteIterations };

    // The file must be written again even with the same budget: switched on
    // or off, or sealed with another key than this device's.
    const rewrap = writeEntry
      ? writeEntry.salt !== remoteSalt || writeEntry.iterations !== remoteIterations
      : encryptedNow;

    // Both copies hold the same data: nothing to move either way.
    if (remoteHash === localHash) {
      await this.remember({ ...where, version, remoteHash, localHash });
      if (rewrap) {
        if (!upload) return 'local-ahead';
        if (!(await this.uploadOver(meta.fileId, version, localText, mode))) return null;
        await tidy();
        return 'pushed';
      }
      await tidy();
      return 'unchanged';
    }

    let action = syncAction({
      remoteExists: true,
      known,
      remoteChanged: !known || remoteHash !== saved.remoteHash,
      localChanged: localHash !== saved.localHash,
      localWork
    });
    if (action === 'up_to_date' && rewrap) action = 'push';

    if (action === 'up_to_date') {
      await this.remember({ ...where, version });
      return 'unchanged';
    }

    if (action === 'push') {
      if (!upload) return 'local-ahead';
      if (!(await this.uploadOver(meta.fileId, version, localText, mode))) return null;
      await tidy();
      return 'pushed';
    }

    if (!remoteText) await read();
    // Unreadable data on either side is still data: never replace it.
    const remoteData = JSON.parse(remoteText);

    if (action === 'pull') {
      this.apply(remoteData);
      const pulledText = this.json();
      await this.remember({ ...where, version, remoteHash, localHash: hashString(pulledText) });
      // Encryption switched here: the pulled budget goes up in the new form.
      if (rewrap && upload) {
        if (!(await this.uploadOver(meta.fileId, version, pulledText, mode))) return null;
        await tidy();
      }
      return 'pulled';
    }

    // merge: both originals go to the backups first.
    this.keep('premerge', localText);
    this.keep('cloud', remoteText);
    const { data, localChanged, remoteChanged } = mergeBudgets(this.store.data, remoteData);
    if (localChanged) this.apply(data);
    const mergedText = this.json();
    // The cloud copy is now part of the local budget. Whatever the cloud
    // still lacks goes up now when uploading is allowed, otherwise on
    // closing or from the Sync button.
    await this.remember({
      ...where,
      version,
      remoteHash,
      localHash: remoteChanged ? null : hashString(mergedText)
    });
    if ((remoteChanged || rewrap) && upload) {
      if (!(await this.uploadOver(meta.fileId, version, mergedText, mode))) return null;
      await tidy();
    }
    return 'merged';
  }
}
