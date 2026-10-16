import { describe, it, expect } from 'vitest';
import {
  keyFromPassword, encryptText, decryptEnvelope, unlockEnvelope, parseEnvelope, envelopeOf,
  passwordStrength, sameKey, fromBase64, toBase64, ITERATIONS, FORMAT
} from '../src/sync/crypto.js';
import { Vault, memoryKeyring } from '../src/sync/vault.js';

// Fewer iterations keep these tests quick; the engine tests use the real count.
const FAST = { iterations: 2000 };
const budget = JSON.stringify({ settings: { language: 'ru' }, entries: [{ id: 'e1', title: 'Аренда', amount: 95000 }] });

describe('encryption envelope', () => {
  it('round trips the budget text and hides it', async () => {
    const entry = await keyFromPassword('correct horse battery', FAST);
    const sealed = await encryptText(budget, entry);
    expect(sealed).not.toContain('95000');
    const envelope = parseEnvelope(JSON.parse(sealed));
    expect(envelope.format).toBe(FORMAT);
    expect(envelope.v).toBe(1);
    expect(envelope.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 2000 });
    expect(fromBase64(envelope.kdf.salt)).toHaveLength(16);
    expect(fromBase64(envelope.iv)).toHaveLength(12);
    expect(await decryptEnvelope(envelope, entry)).toBe(budget);
    // Another device derives the same key from the password and the salt.
    const other = await unlockEnvelope(envelope, 'correct horse battery');
    expect(await decryptEnvelope(envelope, other)).toBe(budget);
  });

  it('uses a fresh IV on every upload, so the bytes always differ', async () => {
    const entry = await keyFromPassword('correct horse battery', FAST);
    const a = JSON.parse(await encryptText(budget, entry));
    const b = JSON.parse(await encryptText(budget, entry));
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
    expect(a.kdf.salt).toBe(b.kdf.salt);
  });

  it('defaults to at least 600 000 iterations and a random salt', async () => {
    expect(ITERATIONS).toBeGreaterThanOrEqual(600000);
    const a = await keyFromPassword('same password', FAST);
    const b = await keyFromPassword('same password', FAST);
    expect(a.salt).not.toBe(b.salt);
  });

  it('tells a wrong password from a damaged file', async () => {
    const entry = await keyFromPassword('correct horse battery', FAST);
    const envelope = JSON.parse(await encryptText(budget, entry));
    await expect(unlockEnvelope(envelope, 'wrong horse battery')).rejects.toMatchObject({ code: 'wrong_password' });
    const bytes = fromBase64(envelope.data);
    bytes[3] ^= 1;
    const damaged = { ...envelope, data: toBase64(bytes) };
    await expect(decryptEnvelope(damaged, entry)).rejects.toMatchObject({ code: 'damaged' });
    // The right password still unlocks it: the file is damaged, not locked.
    await expect(unlockEnvelope(damaged, 'correct horse battery')).resolves.toBeTruthy();
  });

  it('parses only its own envelopes and refuses broken or newer ones', () => {
    expect(envelopeOf(budget)).toBeNull();
    expect(envelopeOf('not json')).toBeNull();
    expect(parseEnvelope({ entries: [] })).toBeNull();
    const good = {
      format: FORMAT, v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' },
      cipher: 'AES-GCM', iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA', check: { iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA' }
    };
    expect(parseEnvelope(good)).toBe(good);
    expect(() => parseEnvelope({ ...good, iv: 42 })).toThrow('damaged');
    expect(() => parseEnvelope({ ...good, kdf: { ...good.kdf, iterations: 10 } })).toThrow('damaged');
    expect(() => parseEnvelope({ ...good, check: null })).toThrow('damaged');
    expect(() => parseEnvelope({ ...good, v: 2 })).toThrow('newer_format');
  });

  it('compares keys without reading them out', async () => {
    const a = await keyFromPassword('correct horse battery', FAST);
    const same = await keyFromPassword('correct horse battery', { salt: a.salt, iterations: a.iterations });
    const other = await keyFromPassword('another password', { salt: a.salt, iterations: a.iterations });
    expect(await sameKey(a.key, same.key)).toBe(true);
    expect(await sameKey(a.key, other.key)).toBe(false);
  });

  it('rates passwords roughly', () => {
    expect(passwordStrength('short')).toBe(0);
    expect(passwordStrength('aaaaaaaaaa')).toBe(1);
    expect(passwordStrength('Budget2026!x')).toBeGreaterThanOrEqual(2);
    expect(passwordStrength('четыре слова подряд и цифра 7')).toBe(3);
  });
});

describe('vault', () => {
  it('keeps a new key apart until its upload is done, and remembers both', async () => {
    const keyring = memoryKeyring();
    const vault = new Vault(keyring);
    const first = await keyFromPassword('first password', FAST);
    await vault.setNext(first);
    expect(vault.current).toBeNull();
    await vault.commit();
    expect(vault.current).toBe(first);
    expect(await vault.matches('first password')).toBe(true);
    expect(await vault.matches('other password')).toBe(false);

    const again = new Vault(keyring);
    await again.load();
    expect(again.current).toBe(first);
    await again.forget();
    expect(await keyring.load()).toBeNull();
  });

  it('reports a keyring that cannot keep the key', async () => {
    const vault = new Vault({ load: async () => null, save: async () => false, forget: async () => {} });
    await vault.setCurrent(await keyFromPassword('first password', FAST));
    expect(vault.stored).toBe(false);
    expect(vault.current).not.toBeNull();
  });
});
