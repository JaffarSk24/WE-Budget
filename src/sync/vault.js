// The encryption key of this device, for the sync engine.
//
//   current  opens the file now in the cloud (its salt and iteration count
//            match that file)
//   next     a new password set here (encryption turned on or the password
//            changed) that the next upload is sealed with; it becomes
//            `current` once that upload is in the cloud
//
// Both are kept by a keyring: the desktop app hands the raw key bits to the
// system keychain through Electron safeStorage, the browser keeps a CryptoKey
// that cannot be read back out in IndexedDB. The password itself is never
// stored. When the keyring cannot keep it, the key lives for this session
// only and the password is asked again after a restart.

import { keyFromPassword, sameKey } from './crypto.js';

export function memoryKeyring() {
  let saved = null;
  return {
    load: async () => saved,
    save: async (value) => { saved = value; return true; },
    forget: async () => { saved = null; }
  };
}

export class Vault {
  constructor(keyring = memoryKeyring()) {
    this.keyring = keyring;
    this.loaded = false;
    this.current = null;
    this.next = null;
    // Whether the keyring keeps the key across restarts.
    this.stored = true;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = await this.keyring.load();
      this.current = (saved && saved.current) || null;
      this.next = (saved && saved.next) || null;
    } catch (e) {
      console.error('Could not read the sync key', e);
    }
  }

  async persist() {
    try {
      if (!this.current && !this.next) {
        await this.keyring.forget();
        this.stored = true;
        return;
      }
      this.stored = (await this.keyring.save({ current: this.current, next: this.next })) !== false;
    } catch (e) {
      this.stored = false;
    }
  }

  // A password typed for the file in the cloud: it replaces whatever this
  // device had, including a password it meant to set itself.
  async setCurrent(entry) {
    this.loaded = true;
    this.current = entry;
    this.next = null;
    await this.persist();
  }

  async setNext(entry) {
    await this.load();
    this.next = entry;
    await this.persist();
  }

  async dropNext() {
    if (!this.next) return;
    this.next = null;
    await this.persist();
  }

  // The upload sealed with `next` is in the cloud.
  async commit() {
    if (!this.next) return;
    this.current = this.next;
    this.next = null;
    await this.persist();
  }

  async forget() {
    this.loaded = true;
    this.current = null;
    this.next = null;
    await this.persist();
  }

  // Whether `password` is the one of the current key: asked before turning
  // encryption off or changing the password.
  async matches(password) {
    await this.load();
    if (!this.current || !password) return false;
    const entry = await keyFromPassword(password, { salt: this.current.salt, iterations: this.current.iterations });
    return sameKey(entry.key, this.current.key);
  }
}
