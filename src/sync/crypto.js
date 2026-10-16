// Encryption of the budget file in the cloud with a password.
//
// Pure functions over the Web Crypto API (crypto.subtle), the same in the
// Electron page, in browsers and in Node for the tests. Only the text that
// goes to the cloud is encrypted; the budget on the device stays as it is.
//
// - The key comes from the password through PBKDF2-SHA256 with a random
//   salt. The salt and the iteration count travel in the file, so the count
//   can be raised later and every device can derive the same key.
// - The budget text is sealed with AES-GCM 256 and a fresh random IV on every
//   upload. GCM also authenticates: a changed byte fails to open.
// - A small sealed constant (`check`) tells a wrong password apart from a
//   damaged file: a wrong key fails on both, a damaged file only on the data.

export const FORMAT = 'we-budget-encrypted';
export const VERSION = 1;
// OWASP's 2023 figure for PBKDF2-SHA256. Raising it later needs no new
// format: the count is stored with the salt.
export const ITERATIONS = 600000;
export const MIN_PASSWORD = 8;
const CHECK_TEXT = 'we-budget-key-check';

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('crypto_unavailable');
  return c.subtle;
}

export function randomBytes(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(s);
}

export function fromBase64(text) {
  const s = globalThis.atob(String(text));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// Errors the sync and the interface tell apart.
export function cryptoError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

// The raw 256 key bits. They are imported as a key that cannot be read back
// out (see importKey); the desktop app also keeps them in the system
// keychain so the password is never stored anywhere.
export async function deriveBits(password, salt, iterations = ITERATIONS) {
  if (typeof password !== 'string' || !password) throw cryptoError('empty_password');
  const base = await subtle().importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  return new Uint8Array(bits);
}

export function importKey(raw) {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// A key with its derivation parameters: { key, raw, salt (base64), iterations }.
// `raw` is kept only so the desktop app can store it; the browser stores the
// CryptoKey itself.
export async function keyFromPassword(password, { salt = null, iterations = ITERATIONS } = {}) {
  const saltBytes = salt ? fromBase64(salt) : randomBytes(16);
  const raw = await deriveBits(password, saltBytes, iterations);
  return { key: await importKey(raw), raw, salt: toBase64(saltBytes), iterations };
}

async function seal(key, bytes) {
  const iv = randomBytes(12);
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv: toBase64(iv), data: toBase64(data) };
}

async function unseal(key, sealed) {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.data));
  return new TextDecoder().decode(plain);
}

// Whether two keys are the same without reading them out (they are not
// extractable): both seal the same zero block with the same zero IV. The
// fixed IV is safe here, the block is a constant and the result is thrown
// away.
export async function sameKey(a, b) {
  const block = new Uint8Array(16);
  const iv = new Uint8Array(12);
  const [x, y] = await Promise.all([a, b].map(k => subtle().encrypt({ name: 'AES-GCM', iv }, k, block)));
  return toBase64(new Uint8Array(x)) === toBase64(new Uint8Array(y));
}

// The envelope uploaded instead of the budget JSON.
export async function encryptText(text, entry) {
  const body = await seal(entry.key, new TextEncoder().encode(text));
  const check = await seal(entry.key, new TextEncoder().encode(CHECK_TEXT));
  return JSON.stringify({
    format: FORMAT,
    v: VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: entry.iterations, salt: entry.salt },
    cipher: 'AES-GCM',
    iv: body.iv,
    data: body.data,
    check
  });
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

// The envelope from a parsed cloud file: null when it is a plain budget, the
// envelope when it is a valid encrypted one. A file that says it is
// encrypted but is malformed is damaged, never a budget.
export function parseEnvelope(value) {
  if (!value || typeof value !== 'object' || value.format !== FORMAT) return null;
  const k = value.kdf || {};
  const ok = value.v === VERSION
    && k.name === 'PBKDF2' && k.hash === 'SHA-256'
    && Number.isInteger(k.iterations) && k.iterations >= 1000 && k.iterations <= 100000000
    && typeof k.salt === 'string' && B64.test(k.salt)
    && typeof value.iv === 'string' && B64.test(value.iv)
    && typeof value.data === 'string' && B64.test(value.data)
    && value.check && typeof value.check.iv === 'string' && typeof value.check.data === 'string';
  if (!ok) throw cryptoError(value.v > VERSION ? 'newer_format' : 'damaged');
  return value;
}

// Text of a cloud file as JSON, or null when it is no JSON at all.
export function envelopeOf(text) {
  let value;
  try { value = JSON.parse(text); } catch (e) { return null; }
  return parseEnvelope(value);
}

// Whether `entry` is the key of this envelope.
export async function keyFits(envelope, entry) {
  if (!entry || entry.salt !== envelope.kdf.salt || entry.iterations !== envelope.kdf.iterations) return false;
  try {
    return (await unseal(entry.key, envelope.check)) === CHECK_TEXT;
  } catch (e) {
    return false;
  }
}

// The budget text of an envelope. A key that fails the check is the wrong
// password; a key that passes it but cannot open the data means the file is
// damaged.
export async function decryptEnvelope(envelope, entry) {
  if (!(await keyFits(envelope, entry))) throw cryptoError('wrong_password');
  try {
    return await unseal(entry.key, envelope);
  } catch (e) {
    throw cryptoError('damaged');
  }
}

// The key for an envelope from a typed password, or a wrong_password error.
export async function unlockEnvelope(envelope, password) {
  const entry = await keyFromPassword(password, { salt: envelope.kdf.salt, iterations: envelope.kdf.iterations });
  if (!(await keyFits(envelope, entry))) throw cryptoError('wrong_password');
  return entry;
}

// A rough hint for the password field: 0 too short, 1 weak, 2 fair, 3 strong.
export function passwordStrength(password) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD) return 0;
  const kinds = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\p{L}\d]/u].filter(re => re.test(p)).length;
  const unique = new Set(p).size;
  let score = 0;
  if (p.length >= 12) score++;
  if (p.length >= 16) score++;
  if (kinds >= 3) score++;
  if (unique < 5) score = 0;
  return Math.max(1, Math.min(3, score));
}
