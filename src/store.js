// WE Budget state store: the single place that mutates the budget document.
//
// Persistence goes through window.weStorage (the Electron preload bridge to a
// JSON file in userData). Plain localStorage is only a fallback for the
// browser dev mode. If the stored document cannot be read, saving is blocked:
// an unreadable file must never be overwritten with an empty budget.

import {
  COLLECTIONS, defaultCategories, emptyData, hasAnyData, live, makeAccount, makeEntry,
  normalizeData, nowIso
} from './model.js';
import { generationHorizon, pendingGeneration, futureOpenEntries } from './schedule.js';
import { buildAllocation } from './allocation.js';
import { buildReconciliation } from './reconcile.js';
import { todayKey, addDays } from './dates.js';

const STORAGE_KEY = 'we_budget_data';

export function browserAdapter() {
  const bridge = typeof window !== 'undefined' ? window.weStorage : null;
  if (bridge) {
    return { load: () => bridge.load(), save: (json) => bridge.save(json), kind: 'file' };
  }
  return {
    load: () => localStorage.getItem(STORAGE_KEY),
    save: (json) => localStorage.setItem(STORAGE_KEY, json),
    kind: 'localStorage'
  };
}

export function memoryAdapter(initial = null) {
  let stored = initial;
  return { load: () => stored, save: (json) => { stored = json; }, kind: 'memory', peek: () => stored };
}

export class Store {
  constructor(adapter, { today = todayKey } = {}) {
    this.adapter = adapter;
    this.today = today;
    this.listeners = [];
    this.loadError = null;
    this.data = this.load();
  }

  load() {
    let raw;
    try {
      raw = this.adapter.load();
    } catch (e) {
      this.loadError = e;
      return emptyData();
    }
    if (raw === null || raw === undefined || raw === '') return emptyData();
    try {
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      console.error('Budget data could not be parsed; saving is blocked', e);
      this.loadError = e;
      return emptyData();
    }
  }

  save() {
    if (this.loadError) return false;
    this.adapter.save(JSON.stringify(this.data));
    return true;
  }

  subscribe(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  emit() {
    this.listeners.forEach(fn => {
      try { fn(this.data); } catch (e) { console.error(e); }
    });
  }

  // Every change goes through here: mutate, persist, notify.
  commit(mutator) {
    const result = mutator(this.data);
    this.save();
    this.emit();
    return result;
  }

  // ---------- reading ----------

  get settings() {
    return this.data.settings;
  }

  list(collection) {
    return live(this.data[collection]);
  }

  find(collection, id) {
    return (this.data[collection] || []).find(r => r.id === id && !r.deleted) || null;
  }

  isEmpty() {
    return !hasAnyData(this.data);
  }

  // ---------- generic writes ----------

  add(collection, record) {
    return this.commit(data => {
      data[collection].push(record);
      return record;
    });
  }

  addMany(collection, records) {
    if (!records.length) return [];
    return this.commit(data => {
      data[collection].push(...records);
      return records;
    });
  }

  update(collection, id, patch) {
    return this.commit(data => {
      const rec = data[collection].find(r => r.id === id);
      if (!rec) return null;
      Object.assign(rec, patch, { updatedAt: nowIso() });
      return rec;
    });
  }

  remove(collection, id) {
    return this.update(collection, id, { deleted: true });
  }

  updateSettings(patch) {
    return this.commit(data => {
      Object.assign(data.settings, patch, { updatedAt: nowIso() });
      return data.settings;
    });
  }

  // ---------- undo ----------

  // A deep copy of the whole document. Small enough (a few hundred KB even
  // with years of history) to take before any destructive action.
  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  // Restores records to their state in `snap`. Restored records get a fresh
  // updatedAt so that a later sync treats the undo as the newest change, and
  // records created after the snapshot become tombstones instead of
  // vanishing.
  restore(snap) {
    return this.commit(data => {
      const now = nowIso();
      COLLECTIONS.forEach(name => {
        const before = new Map((snap[name] || []).map(r => [r.id, r]));
        const current = data[name] || [];
        const seen = new Set();
        data[name] = current.map(rec => {
          seen.add(rec.id);
          const old = before.get(rec.id);
          if (!old) return rec.deleted ? rec : { ...rec, deleted: true, updatedAt: now };
          if (JSON.stringify(old) === JSON.stringify(rec)) return rec;
          return { ...old, updatedAt: now };
        });
        before.forEach((rec, id) => {
          if (!seen.has(id)) data[name].push({ ...rec, updatedAt: now });
        });
      });
      data.settings = { ...snap.settings, updatedAt: now };
    });
  }

  // ---------- first run ----------

  setupFresh({ language = 'ru', accounts = [], trackingStart = null } = {}) {
    return this.commit(data => {
      data.settings.language = language;
      data.settings.trackingStart = trackingStart || todayKey();
      data.settings.onboarded = true;
      data.settings.updatedAt = nowIso();
      if (!live(data.categories).length) data.categories.push(...defaultCategories(language));
      accounts.forEach(a => data.accounts.push(makeAccount(a)));
      if (!data.settings.defaultIncomeAccountId && data.accounts.length) {
        data.settings.defaultIncomeAccountId = data.accounts[0].id;
      }
    });
  }

  // Replaces the whole document (restore from backup, import, demo).
  replaceAll(raw) {
    const next = normalizeData(raw);
    this.loadError = null;
    this.data = next;
    this.save();
    this.emit();
    return next;
  }

  // ---------- templates and generation ----------

  // Creates entries for every template up to the planning horizon.
  generate(today = this.today()) {
    const horizon = generationHorizon(today, this.data.settings.forecastMonths || 3);
    const { entries, marks } = pendingGeneration(this.data, today, horizon);
    const changed = marks.some(m => {
      const t = this.find('templates', m.id);
      return t && t.generatedThrough !== m.generatedThrough;
    });
    if (!entries.length && !changed) return 0;
    this.commit(data => {
      data.entries.push(...entries);
      const now = nowIso();
      marks.forEach(m => {
        const t = data.templates.find(x => x.id === m.id);
        if (t && t.generatedThrough !== m.generatedThrough) {
          t.generatedThrough = m.generatedThrough;
          t.updatedAt = now;
        }
      });
    });
    return entries.length;
  }

  // Saves template edits. With applyToFuture, open entries from today on
  // follow the new values; a changed schedule regenerates them.
  saveTemplate(template, { applyToFuture = true, scheduleChanged = false } = {}) {
    const today = this.today();
    this.commit(data => {
      const now = nowIso();
      const idx = data.templates.findIndex(t => t.id === template.id);
      if (idx === -1) {
        data.templates.push(template);
      } else {
        data.templates[idx] = { ...data.templates[idx], ...template, updatedAt: now };
      }
      if (idx === -1) return;
      const future = futureOpenEntries(data, template.id, today);
      if (scheduleChanged) {
        // Detach rather than keep the template link: a tombstone that still
        // points to the template would block the new occurrences.
        future.forEach(e => Object.assign(e, {
          deleted: true, detachedFrom: e.templateId, templateId: null, updatedAt: now
        }));
        data.templates[idx].generatedThrough = addDays(today, -1);
      } else if (applyToFuture) {
        future.forEach(e => Object.assign(e, {
          title: template.title,
          type: template.type,
          amount: template.amount,
          plannedAmount: template.amount,
          accountId: template.accountId,
          toAccountId: template.type === 'transfer' ? template.toAccountId : null,
          categoryId: template.categoryId,
          isTransit: template.isTransit,
          updatedAt: now
        }));
      }
    });
    this.generate(today);
  }

  removeTemplate(id, { removeFuture = true } = {}) {
    const today = this.today();
    return this.commit(data => {
      const now = nowIso();
      const t = data.templates.find(x => x.id === id);
      if (!t) return;
      Object.assign(t, { deleted: true, updatedAt: now });
      if (removeFuture) {
        futureOpenEntries(data, id, today).forEach(e => Object.assign(e, { deleted: true, updatedAt: now }));
      }
    });
  }

  // ---------- entry statuses ----------

  setStatus(id, status, { amount = null } = {}) {
    return this.commit(data => {
      const e = data.entries.find(x => x.id === id);
      if (!e) return null;
      const now = nowIso();
      if (status === 'done') {
        e.status = 'done';
        e.doneAt = now;
        if (amount !== null) e.amount = amount;
      } else if (status === 'reserved') {
        e.status = 'reserved';
        e.reservedAt = now;
        e.doneAt = null;
      } else if (status === 'planned') {
        e.status = 'planned';
        e.doneAt = null;
        e.reservedAt = null;
        e.allocationId = null;
      } else if (status === 'cancelled') {
        e.status = 'cancelled';
        e.doneAt = null;
      }
      e.updatedAt = now;
      return e;
    });
  }

  // Undoing "done" goes back to "reserved" when the money had been set aside.
  unmarkDone(id) {
    const e = this.find('entries', id);
    if (!e) return null;
    return this.setStatus(id, e.allocationId || e.reservedAt ? 'reserved' : 'planned');
  }

  applyAllocation(plan, day = this.today()) {
    const { newEntries, updates, allocationId } = buildAllocation(plan, day);
    this.commit(data => {
      data.entries.push(...newEntries);
      const now = nowIso();
      updates.forEach(u => {
        const e = data.entries.find(x => x.id === u.id);
        if (e) Object.assign(e, u, { updatedAt: now });
      });
    });
    return allocationId;
  }

  reconcile(accountId, actualBalance, day = this.today(), note = '') {
    const { diff, adjustment, check } = buildReconciliation(this.data, accountId, actualBalance, day, note);
    this.commit(data => {
      if (adjustment) data.entries.push(adjustment);
      data.checks.push(check);
    });
    return diff;
  }

  addQuickExpense({ amount, categoryId, accountId, note = '', date = this.today() }) {
    return this.add('entries', makeEntry({
      date,
      title: note,
      type: 'expense',
      amount,
      accountId,
      categoryId,
      status: 'done',
      doneAt: nowIso(),
      isQuick: true
    }));
  }
}

export const store = new Store(browserAdapter());
