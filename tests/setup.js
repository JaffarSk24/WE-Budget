// Vitest setup: store.js runs in a browser environment; provide minimal
// localStorage/window stubs for the node test environment.
class LocalStorageMock {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

globalThis.localStorage = new LocalStorageMock();
globalThis.window = globalThis.window || {};
