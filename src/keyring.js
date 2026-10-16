// Where this device keeps the sync encryption key between launches (see
// src/sync/vault.js). Never the password, only the key derived from it.
//   desktop  the raw key bits go to the main process, which seals them with
//            the system keychain (Electron safeStorage)
//   browser  the CryptoKey itself goes to IndexedDB; it was created
//            non-extractable, so script on the page cannot read its bytes
// Either may be unavailable (no keychain, private browsing): save() then
// answers false and the key lives for this session only.

import { toBase64, fromBase64, importKey } from './sync/crypto.js';
import { memoryKeyring } from './sync/vault.js';

export function desktopKeyring(bridge) {
  const pack = (e) => (e && e.raw ? { raw: toBase64(e.raw), salt: e.salt, iterations: e.iterations } : null);
  const unpack = async (p) => {
    if (!p || !p.raw) return null;
    const raw = fromBase64(p.raw);
    return { raw, key: await importKey(raw), salt: p.salt, iterations: p.iterations };
  };
  return {
    async load() {
      const result = await bridge.getKey();
      if (!result || !result.value) return null;
      const value = JSON.parse(result.value);
      return { current: await unpack(value.current), next: await unpack(value.next) };
    },
    async save({ current, next }) {
      const result = await bridge.setKey(JSON.stringify({ current: pack(current), next: pack(next) }));
      return Boolean(result && result.stored);
    },
    async forget() {
      await bridge.forgetKey();
    }
  };
}

const DB = 'we-budget-keys';
const STORE = 'keys';
const ID = 'sync';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function browserKeyring() {
  // Only the CryptoKey and its parameters are stored, not the raw bits.
  const pack = (e) => (e ? { key: e.key, salt: e.salt, iterations: e.iterations } : null);
  return {
    async load() {
      const value = await run('readonly', s => s.get(ID));
      return value || null;
    },
    async save({ current, next }) {
      try {
        await run('readwrite', s => s.put({ current: pack(current), next: pack(next) }, ID));
        return true;
      } catch (e) {
        return false;
      }
    },
    async forget() {
      try { await run('readwrite', s => s.delete(ID)); } catch (e) { /* nothing stored */ }
    }
  };
}

export function deviceKeyring() {
  if (typeof window === 'undefined') return memoryKeyring();
  const bridge = window.weCloud;
  if (bridge && typeof bridge.getKey === 'function') return desktopKeyring(bridge);
  if (typeof globalThis.indexedDB !== 'undefined') return browserKeyring();
  // Neither: asked once per session.
  const memory = memoryKeyring();
  return { ...memory, save: async (v) => { await memory.save(v); return false; } };
}
