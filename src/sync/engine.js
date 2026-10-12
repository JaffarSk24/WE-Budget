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

import { COLLECTIONS } from '../model.js';

// Anything recorded here, deletions included: a reset is work too.
function hasRecords(data) {
  return COLLECTIONS.some(name => (data[name] || []).length > 0);
}
import { mergeBudgets } from './merge.js';
import { hashString } from './hash.js';

// 'renew': the web app's hour of access is over; a tap renews it.
export const SYNC_STATUSES = ['unavailable', 'unconfigured', 'checking', 'off', 'idle', 'syncing', 'offline', 'renew', 'reauth', 'error'];

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
  constructor({ store, bridge, keepCopy = null, afterApply = null, intervalMs = 5 * 60 * 1000 }) {
    this.store = store;
    this.bridge = bridge;
    this.keepCopy = keepCopy;
    this.afterApply = afterApply;
    this.intervalMs = intervalMs;
    this.loggedIn = false;
    this.running = null;
    this.again = null;
    this.applying = false;
    this.listeners = [];
    this.state = { status: bridge ? 'checking' : 'unavailable', email: '', lastSyncAt: null, error: null, reauthReason: null, pending: false };
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
    this.loggedIn = Boolean(status.loggedIn);
    // Signed out because Google dropped the sign-in, not by choice: keep
    // asking, a restart must not turn a stopped sync into a quiet one.
    const pending = this.loggedIn ? null : status.signInNeeded || null;
    this.setState({
      status: this.loggedIn ? 'idle' : pending ? 'reauth' : 'off',
      reauthReason: pending ? pending.reason || 'expired' : null,
      email: status.email || (pending && pending.email) || '',
      lastSyncAt: (saved && saved.lastSyncAt) || null
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

  async logout() {
    await this.bridge.logout();
    await this.bridge.setState({ fileId: null, version: null, remoteHash: null, localHash: null, lastSyncAt: null });
    this.loggedIn = false;
    this.setState({ status: 'off', email: '', lastSyncAt: null, error: null, reauthReason: null, pending: false });
  }

  json() {
    return JSON.stringify(this.store.data);
  }

  // Whether the budget changed here since the last sync.
  isDirty(saved) {
    return hashString(this.json()) !== (saved && saved.localHash);
  }

  // Closing the window or quitting: the only automatic upload. Unchanged
  // data is not uploaded at all; changed data goes up only after a look at
  // the cloud (see cycle).
  async flush() {
    if (!this.loggedIn) return { ok: true, outcome: 'off' };
    if (this.running) await this.running;
    const saved = await this.bridge.getState();
    if (!this.isDirty(saved)) return { ok: true, outcome: 'clean' };
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
  async uploadOver(fileId, version, text) {
    if (fileId) {
      const now = await this.call('meta');
      if (!now.exists || now.fileId !== fileId || now.version !== version) return null;
    }
    const up = await this.call('upload', text, fileId);
    const hash = hashString(text);
    await this.remember({ fileId: up.fileId, version: up.version, remoteHash: hash, localHash: hashString(this.json()) });
    return up;
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
      this.setState({ status: 'idle', lastSyncAt, error: null, pending: this.isDirty(saved) });
      return { ok: true, outcome: result, reason };
    } catch (e) {
      if (e.reauth) this.loggedIn = false;
      this.setState({
        status: e.reauth ? 'reauth' : e.renew ? 'renew' : e.offline ? 'offline' : 'error',
        reauthReason: e.reauth ? e.reason || 'expired' : null,
        error: e.message
      });
      return { ok: false, error: e.message, reason };
    }
  }

  // One look at both copies and what follows from it. Returns the outcome,
  // or null when an upload found the cloud changed under it (try again).
  async step({ upload }) {
    const saved = await this.bridge.getState();
    const meta = await this.call('meta');
    // Two devices creating the file at the same moment leave two copies.
    // A spare copy is merged in before it may go: it can hold work the
    // main one lacks.
    const duplicates = (meta.exists && meta.duplicates) || [];
    for (const id of duplicates) {
      const spare = await this.call('download', id);
      this.keep('cloud', spare.content);
      const { data, localChanged } = mergeBudgets(this.store.data, JSON.parse(spare.content));
      if (localChanged) {
        this.apply(data);
        saved.localHash = null;
        await this.remember({ localHash: null });
      }
    }
    // Spare copies are removed once the main file holds everything.
    const tidy = async () => {
      if (!duplicates.length) return;
      try { await this.call('remove', duplicates); } catch (e) { /* tidy-up only */ }
    };
    const localText = this.json();
    const localHash = hashString(localText);
    const localWork = hasRecords(this.store.data);

    if (!meta.exists) {
      const action = syncAction({ remoteExists: false, localWork });
      if (action !== 'push') return 'empty';
      if (!upload) return 'local-ahead';
      return (await this.uploadOver(null, null, localText)) ? 'pushed' : null;
    }

    // The version is only a shortcut: unchanged means nobody wrote. When it
    // moved, the content decides.
    const known = Boolean(saved.fileId && saved.fileId === meta.fileId && saved.remoteHash);
    let remoteText = null;
    let remoteHash = known ? saved.remoteHash : null;
    let version = meta.version;
    if (!known || meta.version !== saved.version) {
      const remote = await this.call('download', meta.fileId);
      remoteText = remote.content;
      remoteHash = hashString(remoteText);
      version = remote.version || meta.version;
    }

    // Both copies hold the same data: nothing to move either way.
    if (remoteHash === localHash) {
      await this.remember({ fileId: meta.fileId, version, remoteHash, localHash });
      await tidy();
      return 'unchanged';
    }

    const action = syncAction({
      remoteExists: true,
      known,
      remoteChanged: !known || remoteHash !== saved.remoteHash,
      localChanged: localHash !== saved.localHash,
      localWork
    });

    if (action === 'up_to_date') {
      await this.remember({ fileId: meta.fileId, version });
      return 'unchanged';
    }

    if (action === 'push') {
      if (!upload) return 'local-ahead';
      if (!(await this.uploadOver(meta.fileId, version, localText))) return null;
      await tidy();
      return 'pushed';
    }

    if (!remoteText) {
      const remote = await this.call('download', meta.fileId);
      remoteText = remote.content;
      remoteHash = hashString(remoteText);
      version = remote.version || version;
    }
    // Unreadable data on either side is still data: never replace it.
    const remoteData = JSON.parse(remoteText);

    if (action === 'pull') {
      this.apply(remoteData);
      await this.remember({ fileId: meta.fileId, version, remoteHash, localHash: hashString(this.json()) });
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
      fileId: meta.fileId,
      version,
      remoteHash,
      localHash: remoteChanged ? null : hashString(mergedText)
    });
    if (remoteChanged && upload) {
      if (!(await this.uploadOver(meta.fileId, version, mergedText))) return null;
      await tidy();
    }
    return 'merged';
  }
}
