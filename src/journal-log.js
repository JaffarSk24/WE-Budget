// The change journal of this device: watches the store, keeps what changed
// in IndexedDB (in the Electron window and in the browser alike). The
// journal is not part of the budget and is not synced: each device keeps
// its own.
//
// Cost on a click: the store only says "something changed" (touch). The
// comparison runs once per turn of the event loop, after all commits of
// that action, and looks only at records whose updatedAt moved (see
// JournalTracker). Writes go to IndexedDB in one transaction a little later.

import { JournalTracker, makeItems, pruneIds, strongestSource } from './journal.js';
import { newId, nowIso } from './model.js';

const DB_NAME = 'we-budget-journal';
const STORE_NAME = 'items';
const WRITE_DELAY_MS = 400;
const PRUNE_EVERY = 200;

export function memoryBackend() {
  let items = [];
  return {
    kind: 'memory',
    put: async (list) => { items = items.concat(list); },
    all: async () => items.slice(),
    remove: async (ids) => {
      const drop = new Set(ids);
      items = items.filter(i => !drop.has(i.id));
    }
  };
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function indexedDbBackend(idb = globalThis.indexedDB) {
  let opening = null;
  const open = () => {
    if (!opening) {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const os = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          os.createIndex('at', 'at');
        }
      };
      opening = request(req);
    }
    return opening;
  };
  return {
    kind: 'indexedDB',
    async put(list) {
      const db = await open();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const os = tx.objectStore(STORE_NAME);
      list.forEach(item => os.put(item));
      await done(tx);
    },
    async all() {
      const db = await open();
      return request(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
    },
    async remove(ids) {
      if (!ids.length) return;
      const db = await open();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const os = tx.objectStore(STORE_NAME);
      ids.forEach(id => os.delete(id));
      await done(tx);
    }
  };
}

export class Journal {
  constructor(backend, { delay = WRITE_DELAY_MS, defer = (fn) => { Promise.resolve().then(fn); } } = {}) {
    this.backend = backend;
    this.delay = delay;
    this.defer = defer;
    this.tracker = new JournalTracker();
    this.store = null;
    this.sources = new Set();
    this.scheduled = false;
    this.queue = [];
    this.timer = null;
    this.writing = Promise.resolve();
    this.sincePrune = 0;
    this.listeners = [];
  }

  // From here on every change of the store is recorded.
  attach(store) {
    this.store = store;
    this.tracker.reset(store.data);
    store.journal = this;
    return this;
  }

  onChange(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  // Called by the store after every change; cheap.
  touch(source = 'local') {
    this.sources.add(source);
    if (this.scheduled) return;
    this.scheduled = true;
    this.defer(() => this.capture());
  }

  // Everything that changed since the last look, as one step.
  capture(at = nowIso()) {
    this.scheduled = false;
    if (!this.store) return [];
    const source = strongestSource(this.sources);
    this.sources.clear();
    // An unreadable budget file is not the budget: nothing to compare.
    if (this.store.loadError) return [];
    const changes = this.tracker.diff(this.store.data);
    if (!changes.length) return [];
    const items = makeItems(changes, { batchId: newId(), at, source });
    this.queue.push(...items);
    this.scheduleWrite();
    this.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    return items;
  }

  scheduleWrite() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.delay);
  }

  // Writes what is queued in one transaction.
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const list = this.queue;
    this.queue = [];
    if (!list.length) return this.writing;
    this.sincePrune += list.length;
    this.writing = this.writing
      .then(() => this.backend.put(list))
      .then(() => (this.sincePrune >= PRUNE_EVERY ? this.prune() : null))
      .catch(e => console.error('Change journal could not be saved', e));
    return this.writing;
  }

  async prune(now = nowIso()) {
    this.sincePrune = 0;
    const items = await this.backend.all();
    const ids = pruneIds(items, now);
    if (ids.length) await this.backend.remove(ids);
    return ids.length;
  }

  // Every kept item, what is still queued included.
  async items() {
    await this.flush();
    try {
      return await this.backend.all();
    } catch (e) {
      console.error('Change journal could not be read', e);
      return [];
    }
  }
}

export function defaultBackend() {
  return typeof indexedDB !== 'undefined' ? indexedDbBackend() : memoryBackend();
}

export const journal = new Journal(defaultBackend());
