// Sync between devices through one file in the user's cloud storage.
//
// The engine runs in the page. The transport (sign-in, download, upload) is
// a bridge object: the Electron preload on the desktop, the browser's own
// OAuth on the phone later. The bridge only moves text; all merging happens
// here, so every device follows the same rules.
//
// One cycle:
//   1. ask the cloud for the file's version (a few bytes);
//   2. if someone else wrote since our last sync, download and merge;
//   3. upload when the result differs from what the cloud has.
// A write that loses a race with another device is not lost: the losing
// device sees a new version on its next cycle, merges again and re-uploads.

import { hasAnyData, live } from '../model.js';
import { decideDataset, mergeBudgets } from './merge.js';
import { hashString } from './hash.js';

// 'renew': the web app's hour of access is over; a tap renews it.
export const SYNC_STATUSES = ['unavailable', 'unconfigured', 'checking', 'off', 'idle', 'syncing', 'offline', 'renew', 'reauth', 'error', 'conflict'];

function budgetSummary(data) {
  const entries = live(data.entries);
  const dates = entries.map(e => e.date).sort();
  return {
    entries: entries.length,
    accounts: live(data.accounts).length,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    datasetAt: data.datasetAt || null
  };
}

export class SyncEngine {
  constructor({ store, bridge, ask = async () => null, afterApply = null, debounceMs = 8000, intervalMs = 5 * 60 * 1000 }) {
    this.store = store;
    this.bridge = bridge;
    this.ask = ask;
    this.afterApply = afterApply;
    this.debounceMs = debounceMs;
    this.intervalMs = intervalMs;
    this.loggedIn = false;
    this.running = null;
    this.again = false;
    this.applying = false;
    this.timer = null;
    this.listeners = [];
    this.state = { status: bridge ? 'checking' : 'unavailable', email: '', lastSyncAt: null, error: null, reauthReason: null };
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

  async init({ auto = true } = {}) {
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
    if (this.loggedIn) await this.sync('startup');
  }

  startAuto() {
    this.store.subscribe(() => {
      if (this.applying || !this.loggedIn) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.sync('change'), this.debounceMs);
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
    await this.bridge.setState({ fileId: null, version: null, datasetId: null, pushedHash: null, lastSyncAt: null });
    this.loggedIn = false;
    clearTimeout(this.timer);
    this.setState({ status: 'off', email: '', lastSyncAt: null, error: null, reauthReason: null });
  }

  json() {
    return JSON.stringify(this.store.data);
  }

  isDirty(saved) {
    return hashString(this.json()) !== (saved && saved.pushedHash);
  }

  // Last chance before the app closes: upload what is not in the cloud yet.
  async flush() {
    if (!this.loggedIn) return { ok: true, outcome: 'off' };
    if (this.running) await this.running;
    const saved = await this.bridge.getState();
    if (!this.isDirty(saved)) return { ok: true, outcome: 'clean' };
    return this.sync('close', { final: true });
  }

  sync(reason = 'manual', options = {}) {
    if (!this.loggedIn) return Promise.resolve({ ok: false, outcome: 'off' });
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.cycle(reason, options).finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.sync('again');
      }
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
    if (this.afterApply) this.afterApply();
  }

  async remember(location) {
    await this.bridge.setState({
      fileId: location.fileId,
      version: location.version,
      datasetId: this.store.data.datasetId,
      pushedHash: hashString(this.json())
    });
  }

  async upload(fileId) {
    const up = await this.call('upload', this.json(), fileId);
    await this.remember(up);
  }

  async cycle(reason, { final = false } = {}) {
    this.setState({ status: 'syncing' });
    try {
      const saved = await this.bridge.getState();
      const meta = await this.call('meta');
      let outcome = 'unchanged';

      if (!meta.exists) {
        if (hasAnyData(this.store.data)) {
          await this.upload(null);
          outcome = 'pushed';
        } else {
          outcome = 'empty';
        }
      } else if (meta.fileId !== saved.fileId || meta.version !== saved.version) {
        if (final && !this.isDirty(saved)) {
          outcome = 'skipped';
        } else {
          const remote = await this.call('download', meta.fileId);
          const remoteData = JSON.parse(remote.content);
          let decision = decideDataset(this.store.data, remoteData, saved);
          // Only a sync the owner started may ask a question; background
          // cycles leave the conflict standing instead of nagging.
          const mayAsk = !final && ['manual', 'login', 'startup'].includes(reason);
          if (decision === 'ask') {
            decision = !mayAsk ? 'skip' : ((await this.ask({
              local: budgetSummary(this.store.data),
              remote: budgetSummary(remoteData)
            })) || 'skip');
          }

          if (decision === 'take-remote') {
            this.apply(remoteData);
            await this.remember({ fileId: meta.fileId, version: remote.version });
            outcome = 'pulled';
          } else if (decision === 'keep-local') {
            await this.upload(meta.fileId);
            outcome = 'pushed';
          } else if (decision === 'merge') {
            const { data, localChanged, remoteChanged } = mergeBudgets(this.store.data, remoteData);
            if (localChanged) this.apply(data);
            if (remoteChanged) await this.upload(meta.fileId);
            else await this.remember({ fileId: meta.fileId, version: remote.version });
            outcome = 'merged';
          } else {
            this.setState({ status: 'conflict' });
            return { ok: false, outcome: 'conflict' };
          }
        }
      } else if (this.isDirty(saved)) {
        await this.upload(meta.fileId);
        outcome = 'pushed';
      }

      if (meta.duplicates && meta.duplicates.length) {
        try { await this.call('remove', meta.duplicates); } catch (e) { /* tidy-up only */ }
      }
      const lastSyncAt = new Date().toISOString();
      await this.bridge.setState({ lastSyncAt });
      this.setState({ status: 'idle', lastSyncAt, error: null });
      return { ok: true, outcome, reason };
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
}
