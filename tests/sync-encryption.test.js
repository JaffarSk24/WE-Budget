import { describe, it, expect } from 'vitest';
import { Store, memoryAdapter } from '../src/store.js';
import { SyncEngine } from '../src/sync/engine.js';
import { Vault, memoryKeyring } from '../src/sync/vault.js';
import { envelopeOf } from '../src/sync/crypto.js';
import { pickMain, PLAIN_NAME, ENCRYPTED_NAME } from '../src/web/cloud-web.js';
import { makeAccount, makeEntry, emptyData, live } from '../src/model.js';
import cloudUtils from '../main/cloud-utils.cjs';

// A fake Drive app folder with several named files, shaped like the real
// transports: listing picks the main file by the same rule (pickMain),
// writing over a file may rename it.
function fakeDrive() {
  const drive = { files: [], writes: 0, clock: 0, ids: 0, offline: false };
  const sorted = () => drive.files.slice().sort((a, b) => b.modified - a.modified);
  const find = (id) => drive.files.find(f => f.id === id);
  drive.main = () => find(pickMain(sorted()).fileId);
  drive.write = (content, fileId, name) => {
    JSON.parse(content);
    drive.writes++;
    const existing = fileId && find(fileId);
    if (existing) {
      Object.assign(existing, { content, name, version: existing.version + 1, modified: ++drive.clock });
      return existing;
    }
    const file = { id: `file-${++drive.ids}`, name, content, version: 1, modified: ++drive.clock };
    drive.files.push(file);
    return file;
  };
  // `old`: an app version 1.1.5 or older, which only knows the plain name
  // and always writes plain files.
  drive.bridge = ({ old = false } = {}) => {
    let saved = {};
    const fail = () => ({ ok: false, error: 'fetch failed', offline: true });
    return {
      status: async () => ({ configured: true, loggedIn: true, email: 'owner@example.com' }),
      login: async () => ({ ok: true, email: 'owner@example.com' }),
      logout: async () => ({ ok: true }),
      getState: async () => ({ ...saved }),
      setState: async (patch) => { saved = { ...saved, ...patch }; return { ok: true }; },
      meta: async () => {
        if (drive.offline) return fail();
        const visible = sorted().filter(f => !old || f.name === PLAIN_NAME);
        return { ok: true, ...pickMain(visible) };
      },
      download: async (id) => {
        if (drive.offline) return fail();
        const f = find(id);
        return { ok: true, content: f.content, version: String(f.version), fileId: id };
      },
      upload: async (content, fileId, encrypted) => {
        if (drive.offline) return fail();
        const f = drive.write(content, fileId, encrypted && !old ? ENCRYPTED_NAME : PLAIN_NAME);
        return { ok: true, fileId: f.id, version: String(f.version) };
      },
      remove: async (ids) => {
        drive.files = drive.files.filter(f => !ids.includes(f.id));
        return { ok: true };
      }
    };
  };
  return drive;
}

// A device: its budget, its sync state and its keyring survive a restart.
function device(drive, { initial = null, old = false } = {}) {
  const store = new Store(memoryAdapter(initial ? JSON.stringify(initial) : null), { today: () => '2026-10-05' });
  const bridge = drive.bridge({ old });
  const keyring = memoryKeyring();
  const copies = [];
  const make = () => new SyncEngine({
    store, bridge, vault: new Vault(keyring),
    keepCopy: (tag, json) => copies.push({ tag, json }), afterApply: () => store.generate()
  });
  return { store, bridge, keyring, copies, engine: make(), make };
}

async function start(d) {
  await d.engine.init({ auto: false });
  return d;
}

async function restart(d) {
  await d.engine.flush();
  d.engine = d.make();
  await d.engine.init({ auto: false });
  return d;
}

function seed() {
  const data = emptyData();
  data.settings.trackingStart = '2026-10-01';
  data.settings.onboarded = true;
  const acc = makeAccount({ name: 'Main', openingBalance: 100000 });
  data.accounts.push(acc);
  data.entries.push(
    makeEntry({ date: '2026-10-06', title: 'Rent', amount: 95000, accountId: acc.id }),
    makeEntry({ date: '2026-10-08', title: 'Phone', amount: 2500, accountId: acc.id })
  );
  return data;
}

const PASSWORD = 'correct horse battery';
const titles = (d) => live(d.store.data.entries).map(e => e.title).sort();
const accountOf = (d) => d.store.list('accounts')[0].id;
const add = (d, title) => d.store.add('entries', makeEntry({ date: '2026-10-20', title, amount: 1000, accountId: accountOf(d) }));
const tick = () => new Promise(r => setTimeout(r, 3));

// Opens the main file the way a device with the password would.
async function cloudTitles(drive, d) {
  const main = drive.main();
  const envelope = envelopeOf(main.content);
  const text = envelope ? await d.engine.readFile(main.id).then(r => r.text) : main.content;
  return live(JSON.parse(text).entries).map(e => e.title).sort();
}

// A and B share a plain budget; then A turns encryption on.
async function encryptedPair(drive) {
  const a = await start(device(drive, { initial: seed() }));
  await a.engine.flush();
  const b = await start(device(drive));
  await tick();
  const on = await a.engine.enableEncryption(PASSWORD);
  expect(on.ok).toBe(true);
  return { a, b };
}

// Each test derives keys with 600 000 PBKDF2 rounds on purpose; on a busy
// machine that alone can take longer than the default 5 seconds.
describe('encrypted sync', { timeout: 30000 }, () => {
  it('turning encryption on renames the one file and seals it', async () => {
    const drive = fakeDrive();
    const { a } = await encryptedPair(drive);
    expect(drive.files).toHaveLength(1);
    const main = drive.main();
    expect(main.name).toBe(ENCRYPTED_NAME);
    expect(main.content).not.toContain('Rent');
    expect(envelopeOf(main.content).kdf.iterations).toBeGreaterThanOrEqual(600000);
    expect(a.engine.state.encrypted).toBe(true);
    expect(await cloudTitles(drive, a)).toEqual(['Phone', 'Rent']);
    // The local budget stays plain.
    expect(titles(a)).toEqual(['Phone', 'Rent']);
  });

  it('a device without the password pauses and never writes, then merges after the password', async () => {
    const drive = fakeDrive();
    const { a, b } = await encryptedPair(drive);
    add(b, 'Books');
    await tick();
    add(a, 'Gift');
    await a.engine.flush();
    const writes = drive.writes;
    const before = drive.main().content;

    const pulled = await b.engine.sync('focus');
    expect(pulled.ok).toBe(false);
    expect(b.engine.state.status).toBe('locked');
    expect(b.engine.state.locked).toBe(true);
    expect(b.engine.state.lockReason).toBe('password');
    await b.engine.flush();
    await b.engine.sync('manual');
    expect(drive.writes).toBe(writes);
    expect(drive.main().content).toBe(before);
    expect(titles(b)).toEqual(['Books', 'Phone', 'Rent']);
    expect(b.copies).toHaveLength(0);

    const wrong = await b.engine.unlock('wrong horse battery');
    expect(wrong).toMatchObject({ ok: false, error: 'wrong_password' });
    expect(drive.writes).toBe(writes);
    expect(b.engine.state.locked).toBe(true);

    const right = await b.engine.unlock(PASSWORD);
    expect(right.ok).toBe(true);
    expect(right.synced.outcome).toBe('merged');
    expect(titles(b)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
    // Unlocking only takes; B's own work goes up on closing, sealed.
    expect(drive.writes).toBe(writes);
    await b.engine.flush();
    expect(drive.main().name).toBe(ENCRYPTED_NAME);
    expect(drive.main().content).not.toContain('Books');
    await restart(a);
    expect(titles(a)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
  });

  it('unchanged data is not uploaded again, although every seal differs', async () => {
    const drive = fakeDrive();
    const { a, b } = await encryptedPair(drive);
    const writes = drive.writes;
    expect((await a.engine.flush()).outcome).toBe('clean');
    expect((await a.engine.sync('manual')).outcome).toBe('unchanged');
    await b.engine.sync('focus');
    expect((await b.engine.unlock(PASSWORD)).ok).toBe(true);
    expect((await b.engine.flush()).outcome).toBe('clean');
    expect((await b.engine.sync('manual')).outcome).toBe('unchanged');
    // A restart reads the key from the keyring and stays quiet too.
    await restart(b);
    expect(b.engine.state.locked).toBe(false);
    expect((await b.engine.sync('manual')).outcome).toBe('unchanged');
    expect(drive.writes).toBe(writes);
  });

  it('a changed password reseals the same data; other devices ask for the new one', async () => {
    const drive = fakeDrive();
    const { a, b } = await encryptedPair(drive);
    await b.engine.unlock(PASSWORD);
    const writes = drive.writes;
    expect((await a.engine.changePassword('wrong horse battery', 'new secret phrase')).error).toBe('wrong_password');
    expect(drive.writes).toBe(writes);
    const changed = await a.engine.changePassword(PASSWORD, 'new secret phrase');
    expect(changed.ok).toBe(true);
    expect(drive.writes).toBe(writes + 1);
    expect(drive.files).toHaveLength(1);

    await b.engine.sync('focus');
    expect(b.engine.state.status).toBe('locked');
    expect(b.engine.state.lockReason).toBe('changed');
    expect((await b.engine.unlock(PASSWORD)).error).toBe('wrong_password');
    const unlocked = await b.engine.unlock('new secret phrase');
    expect(unlocked.synced.outcome).toBe('unchanged');
    expect(drive.writes).toBe(writes + 1);
  });

  it('turning encryption off asks for the password and uploads plain', async () => {
    const drive = fakeDrive();
    const { a, b } = await encryptedPair(drive);
    await b.engine.unlock(PASSWORD);
    const writes = drive.writes;
    expect((await a.engine.disableEncryption('wrong horse battery')).error).toBe('wrong_password');
    expect(drive.writes).toBe(writes);
    const off = await a.engine.disableEncryption(PASSWORD);
    expect(off.ok).toBe(true);
    expect(drive.files).toHaveLength(1);
    expect(drive.main().name).toBe(PLAIN_NAME);
    expect(envelopeOf(drive.main().content)).toBeNull();
    expect(a.engine.state.encrypted).toBe(false);
    expect(await a.keyring.load()).toBeNull();

    // B notices, drops its key and goes on plain.
    add(b, 'Books');
    await b.engine.flush();
    expect(b.engine.state.encrypted).toBe(false);
    expect(await b.keyring.load()).toBeNull();
    expect(drive.main().name).toBe(PLAIN_NAME);
    expect(drive.main().content).toContain('Books');
  });

  it('a plain file of an older version next to the encrypted one is merged, then removed', async () => {
    const drive = fakeDrive();
    const { a } = await encryptedPair(drive);
    // The older version cannot see the encrypted file: to it the cloud is
    // empty, so it uploads its own plain budget on closing.
    const old = await start(device(drive, { initial: seed(), old: true }));
    old.store.add('entries', makeEntry({ date: '2026-10-22', title: 'Taxi', amount: 1500, accountId: accountOf(old) }));
    await old.engine.flush();
    expect(drive.files.map(f => f.name).sort()).toEqual([ENCRYPTED_NAME, PLAIN_NAME]);
    const encrypted = drive.files.find(f => f.name === ENCRYPTED_NAME);
    const sealed = encrypted.content;

    await a.engine.sync('interval');
    expect(titles(a)).toContain('Taxi');
    // Background syncs only take: the plain copy stays until A uploads.
    expect(drive.files).toHaveLength(2);
    expect(encrypted.content).toBe(sealed);
    await a.engine.flush();
    expect(drive.files).toHaveLength(1);
    expect(drive.main().name).toBe(ENCRYPTED_NAME);
    expect(await cloudTitles(drive, a)).toContain('Taxi');
  });

  it('an older version never touches the encrypted file', async () => {
    const drive = fakeDrive();
    const { a } = await encryptedPair(drive);
    const encrypted = drive.main();
    const sealed = encrypted.content;
    const old = await start(device(drive, { initial: seed(), old: true }));
    // It sees an empty cloud: it takes nothing, and on closing it can only
    // add a plain file of its own next to the encrypted one.
    expect(titles(old)).toEqual(['Phone', 'Rent']);
    add(old, 'Taxi');
    await old.engine.flush();
    expect(drive.files).toContain(encrypted);
    expect(encrypted.name).toBe(ENCRYPTED_NAME);
    expect(encrypted.content).toBe(sealed);
    expect(await cloudTitles(drive, a)).toEqual(['Phone', 'Rent']);
  });

  it('a device without the password does not merge a spare copy either', async () => {
    const drive = fakeDrive();
    await encryptedPair(drive);
    const old = await start(device(drive, { initial: seed(), old: true }));
    await old.engine.flush();
    const c = await start(device(drive));
    expect(c.engine.state.status).toBe('locked');
    expect(titles(c)).toEqual([]);
    expect(drive.files).toHaveLength(2);
  });

  it('turned on while offline, the switch goes up on closing', async () => {
    const drive = fakeDrive();
    const a = await start(device(drive, { initial: seed() }));
    await a.engine.flush();
    drive.offline = true;
    const on = await a.engine.enableEncryption(PASSWORD);
    expect(on.ok).toBe(false);
    expect(on.synced.ok).toBe(false);
    expect(drive.main().name).toBe(PLAIN_NAME);
    drive.offline = false;
    // The new key survives a restart; background syncs only take.
    a.engine = a.make();
    await a.engine.init({ auto: false });
    expect(a.engine.state.pending).toBe(true);
    expect((await a.engine.sync('focus')).outcome).toBe('local-ahead');
    expect(drive.main().name).toBe(PLAIN_NAME);
    expect((await a.engine.flush()).outcome).toBe('pushed');
    expect(drive.main().name).toBe(ENCRYPTED_NAME);
    expect(drive.files).toHaveLength(1);
  });

  it('turning encryption on before anything is in the cloud creates the encrypted file', async () => {
    const drive = fakeDrive();
    const a = await start(device(drive, { initial: seed() }));
    expect((await a.engine.enableEncryption(PASSWORD)).ok).toBe(true);
    expect(drive.files).toHaveLength(1);
    expect(drive.main().name).toBe(ENCRYPTED_NAME);
    expect(await cloudTitles(drive, a)).toEqual(['Phone', 'Rent']);
  });

  it('forgetting the password pauses sync on this device only', async () => {
    const drive = fakeDrive();
    const { a } = await encryptedPair(drive);
    const writes = drive.writes;
    await a.engine.forgetPassword();
    expect(a.engine.state.status).toBe('locked');
    expect(await a.keyring.load()).toBeNull();
    add(a, 'Books');
    await a.engine.flush();
    expect(drive.writes).toBe(writes);
    expect((await a.engine.unlock(PASSWORD)).ok).toBe(true);
    await a.engine.flush();
    expect(await cloudTitles(drive, a)).toContain('Books');
  });

  it('a damaged encrypted file is reported and never written over', async () => {
    const drive = fakeDrive();
    const { a } = await encryptedPair(drive);
    const main = drive.main();
    const envelope = JSON.parse(main.content);
    envelope.data = envelope.data.slice(0, -8) + 'AAAAAAA=';
    main.content = JSON.stringify(envelope);
    main.version++;
    const writes = drive.writes;
    add(a, 'Books');
    const result = await a.engine.flush();
    expect(result.ok).toBe(false);
    expect(a.engine.state.status).toBe('error');
    expect(a.engine.state.error).toBe('damaged');
    expect(drive.writes).toBe(writes);
  });

  it('desktop and web pick the main file by the same rule', () => {
    const files = [
      { id: 'p2', name: PLAIN_NAME, version: 3, modifiedTime: '3' },
      { id: 'e1', name: ENCRYPTED_NAME, version: 7, modifiedTime: '2' },
      { id: 'p1', name: PLAIN_NAME, version: 1, modifiedTime: '1' }
    ];
    const web = pickMain(files);
    expect(web).toMatchObject({ exists: true, fileId: 'e1', version: '7', encrypted: true, duplicates: ['p2', 'p1'] });
    expect(cloudUtils.pickMain(files)).toEqual(web);
    expect(pickMain([files[0], files[2]])).toMatchObject({ fileId: 'p2', encrypted: false, duplicates: ['p1'] });
    expect(pickMain([])).toEqual({ exists: false });
    expect(cloudUtils.PLAIN_NAME).toBe(PLAIN_NAME);
    expect(cloudUtils.ENCRYPTED_NAME).toBe(ENCRYPTED_NAME);
  });
});
