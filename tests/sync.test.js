import { describe, it, expect } from 'vitest';
import { Store, memoryAdapter } from '../src/store.js';
import { SyncEngine, syncAction } from '../src/sync/engine.js';
import { mergeBudgets, dedupeOccurrences } from '../src/sync/merge.js';
import { makeAccount, makeEntry, makeTemplate, emptyData, live } from '../src/model.js';

// One shared fake cloud file and a bridge per device, shaped like the
// Electron preload: every call resolves to { ok, ... }.
function fakeCloud() {
  const cloud = { file: null, writes: 0 };
  cloud.bridge = () => {
    let saved = {};
    let loggedIn = true;
    return {
      status: async () => ({ configured: true, loggedIn, email: 'owner@example.com' }),
      login: async () => { loggedIn = true; return { ok: true, email: 'owner@example.com' }; },
      logout: async () => { loggedIn = false; return { ok: true }; },
      getState: async () => ({ ...saved }),
      setState: async (patch) => { saved = { ...saved, ...patch }; return { ok: true }; },
      meta: async () => cloud.file
        ? { ok: true, exists: true, fileId: cloud.file.id, version: cloud.file.version }
        : { ok: true, exists: false },
      download: async () => ({ ok: true, content: cloud.file.content, version: cloud.file.version, fileId: cloud.file.id }),
      upload: async (content) => {
        cloud.writes++;
        cloud.file = { id: 'file-1', version: String(cloud.writes), content };
        return { ok: true, fileId: 'file-1', version: cloud.file.version };
      },
      remove: async () => ({ ok: true })
    };
  };
  return cloud;
}

function device(cloud, { today = '2026-10-05', initial = null } = {}) {
  const store = new Store(memoryAdapter(initial ? JSON.stringify(initial) : null), { today: () => today });
  const copies = [];
  const bridge = cloud.bridge();
  const make = () => new SyncEngine({ store, bridge, keepCopy: (tag, json) => copies.push({ tag, json }), afterApply: () => store.generate() });
  return { store, bridge, copies, engine: make(), make };
}

async function start(d) {
  await d.engine.init({ auto: false });
  return d;
}

// Quitting and opening the app again: the same data and sync state, a new
// engine.
async function restart(d) {
  await d.engine.flush();
  d.engine = d.make();
  await d.engine.init({ auto: false });
  return d;
}

const titles = (d) => live(d.store.data.entries).map(e => e.title).sort();
const cloudTitles = (cloud) => live(JSON.parse(cloud.file.content).entries).map(e => e.title).sort();
const accountOf = (d) => d.store.list('accounts')[0].id;

// Two devices that already share the budget: A uploaded it on closing, B
// took it on launch.
async function shared(cloud) {
  const a = await start(device(cloud, { initial: seed() }));
  await a.engine.flush();
  const b = await start(device(cloud));
  await tick();
  return { a, b };
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

// Timestamps must move forward between edits made in the same millisecond.
const tick = () => new Promise(r => setTimeout(r, 3));

describe('merge rules', () => {
  it('newer record wins, records known on one side are kept, both sides converge', () => {
    const a = seed();
    const b = JSON.parse(JSON.stringify(a));
    // Far-future stamps: the edits must be newer than the seed whatever the
    // clock says when the test runs.
    a.entries[0] = { ...a.entries[0], amount: 99000, updatedAt: '2099-10-05T10:00:00.000Z' };
    b.entries[1] = { ...b.entries[1], title: 'Mobile', updatedAt: '2099-10-05T11:00:00.000Z' };
    b.entries.push(makeEntry({ date: '2026-10-09', title: 'Gym', amount: 3000, accountId: a.accounts[0].id }));

    const ab = mergeBudgets(a, b).data;
    const ba = mergeBudgets(b, a).data;
    const view = (d) => d.entries.map(e => `${e.title}:${e.amount}`).sort();
    expect(view(ab)).toEqual(['Gym:3000', 'Mobile:2500', 'Rent:99000']);
    expect(view(ba)).toEqual(view(ab));
  });

  it('a deletion is not undone by an older copy', () => {
    const a = seed();
    const b = JSON.parse(JSON.stringify(a));
    a.entries[0] = { ...a.entries[0], deleted: true, updatedAt: '2099-10-05T12:00:00.000Z' };
    const merged = mergeBudgets(b, a).data;
    expect(live(merged.entries).map(e => e.title)).toEqual(['Phone']);
  });

  it('reports which side has to be updated', () => {
    const a = seed();
    const same = mergeBudgets(a, JSON.parse(JSON.stringify(a)));
    expect([same.localChanged, same.remoteChanged]).toEqual([false, false]);
    const b = JSON.parse(JSON.stringify(a));
    b.entries[0] = { ...b.entries[0], amount: 1, updatedAt: '2099-01-01T00:00:00.000Z' };
    const r = mergeBudgets(a, b);
    expect([r.localChanged, r.remoteChanged]).toEqual([true, false]);
  });

  it('keeps the furthest generation mark without outvoting edits', () => {
    const a = seed();
    const t = makeTemplate({ title: 'Rent', amount: 95000, schedule: { freq: 'monthly', day: 1 } });
    a.templates.push({ ...t, generatedThrough: '2027-01-31', updatedAt: '2026-10-01T00:00:00.000Z' });
    const b = JSON.parse(JSON.stringify(a));
    b.templates[0] = { ...b.templates[0], amount: 99000, generatedThrough: '2026-12-31', updatedAt: '2026-10-02T00:00:00.000Z' };
    const merged = mergeBudgets(a, b).data.templates[0];
    expect(merged.amount).toBe(99000);
    expect(merged.generatedThrough).toBe('2027-01-31');
  });

  it('removes duplicate occurrences, keeping the one that went furthest', () => {
    const base = { templateId: 't1', occurrence: '2026-11-01', date: '2026-11-01', amount: 100 };
    const planned = makeEntry({ ...base });
    const done = makeEntry({ ...base, status: 'done' });
    const { entries, removed } = dedupeOccurrences([planned, done], '2026-10-05T00:00:00.000Z');
    expect(removed).toBe(1);
    expect(live(entries).map(e => e.id)).toEqual([done.id]);
  });

  it('chooses between taking, sending and merging from the content of both copies', () => {
    const base = { remoteExists: true, known: true, remoteChanged: false, localChanged: false, localWork: true };
    expect(syncAction(base)).toBe('up_to_date');
    expect(syncAction({ ...base, remoteChanged: true })).toBe('pull');
    expect(syncAction({ ...base, localChanged: true })).toBe('push');
    expect(syncAction({ ...base, remoteChanged: true, localChanged: true })).toBe('merge');
    expect(syncAction({ ...base, known: false })).toBe('merge');
    expect(syncAction({ ...base, known: false, localWork: false })).toBe('pull');
    expect(syncAction({ ...base, remoteExists: false })).toBe('push');
    expect(syncAction({ ...base, remoteExists: false, localWork: false })).toBe('up_to_date');
  });
});

describe('two devices', () => {
  it('launch never uploads; closing does, once', async () => {
    const cloud = fakeCloud();
    const a = await start(device(cloud, { initial: seed() }));
    expect(cloud.writes).toBe(0);
    expect(cloud.file).toBe(null);
    await a.engine.sync('interval');
    await a.engine.sync('focus');
    expect(cloud.writes).toBe(0);
    await a.engine.flush();
    expect(cloud.writes).toBe(1);
    expect((await a.engine.flush()).outcome).toBe('clean');
    expect(cloud.writes).toBe(1);
  });

  it('a second device signing in gets the budget from the cloud and uploads nothing', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    expect(titles(b)).toEqual(['Phone', 'Rent']);
    expect(b.store.data.datasetId).toBe(a.store.data.datasetId);
    expect(cloud.writes).toBe(1);
    expect((await b.engine.flush()).outcome).toBe('clean');
    expect(cloud.writes).toBe(1);
  });

  it('an old computer takes the new data on launch and uploads nothing on closing', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    await b.engine.flush();
    a.store.add('entries', makeEntry({ date: '2026-10-20', title: 'Gift', amount: 5000, accountId: accountOf(a) }));
    await a.engine.flush();
    const writes = cloud.writes;
    await restart(b);
    expect(titles(b)).toEqual(['Gift', 'Phone', 'Rent']);
    expect(cloud.writes).toBe(writes);
    expect((await b.engine.flush()).outcome).toBe('clean');
    expect(cloud.writes).toBe(writes);
    expect(cloudTitles(cloud)).toEqual(['Gift', 'Phone', 'Rent']);
  });

  it('a computer with old data closed after the other uploaded sends the union', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    // B works without seeing A's upload.
    b.store.add('entries', makeEntry({ date: '2026-10-21', title: 'Books', amount: 2000, accountId: accountOf(b) }));
    await tick();
    a.store.add('entries', makeEntry({ date: '2026-10-20', title: 'Gift', amount: 5000, accountId: accountOf(a) }));
    await a.engine.flush();
    await b.engine.flush();
    expect(cloudTitles(cloud)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
    expect(titles(b)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
    await restart(a);
    expect(titles(a)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
    // Both originals of the merge were kept.
    expect(b.copies.map(c => c.tag).sort()).toEqual(['cloud', 'premerge']);
    expect(JSON.parse(b.copies.find(c => c.tag === 'cloud').json).entries.some(e => e.title === 'Gift')).toBe(true);
  });

  it('the same data uploaded again does not make the other computer drop its changes', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    b.store.update('entries', live(b.store.data.entries).find(e => e.title === 'Phone').id, { amount: 3000 });
    // A writes the very same content again: the file's version moves.
    await a.bridge.upload(cloud.file.content, cloud.file.id);
    const result = await b.engine.sync('interval');
    expect(result.outcome).toBe('local-ahead');
    expect(b.copies).toHaveLength(0);
    expect(live(b.store.data.entries).find(e => e.title === 'Phone').amount).toBe(3000);
    await b.engine.flush();
    expect(live(JSON.parse(cloud.file.content).entries).find(e => e.title === 'Phone').amount).toBe(3000);
  });

  it('pulls in the background, merges what both changed, and leaves the upload for closing', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    b.store.add('entries', makeEntry({ date: '2026-10-21', title: 'Books', amount: 2000, accountId: accountOf(b) }));
    a.store.add('entries', makeEntry({ date: '2026-10-20', title: 'Gift', amount: 5000, accountId: accountOf(a) }));
    await a.engine.flush();
    const writes = cloud.writes;
    expect((await b.engine.sync('focus')).outcome).toBe('merged');
    expect(titles(b)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
    expect(cloud.writes).toBe(writes);
    expect(b.engine.state.pending).toBe(true);
    await b.engine.flush();
    expect(cloudTitles(cloud)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
  });

  it('an upload that finds the cloud changed under it merges first', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    b.store.add('entries', makeEntry({ date: '2026-10-21', title: 'Books', amount: 2000, accountId: accountOf(b) }));
    a.store.add('entries', makeEntry({ date: '2026-10-20', title: 'Gift', amount: 5000, accountId: accountOf(a) }));
    // A uploads between B's look at the cloud and B's write.
    const realMeta = b.bridge.meta;
    let calls = 0;
    b.bridge.meta = async () => {
      calls++;
      if (calls === 2) await a.engine.flush();
      return realMeta();
    };
    await b.engine.flush();
    b.bridge.meta = realMeta;
    expect(cloudTitles(cloud)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
  });

  it('a merge keeps deletions', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    // B edits the record first, A deletes it later; B also adds one.
    b.store.update('entries', live(b.store.data.entries).find(e => e.title === 'Phone').id, { amount: 3000 });
    b.store.add('entries', makeEntry({ date: '2026-10-21', title: 'Books', amount: 2000, accountId: accountOf(b) }));
    await tick();
    a.store.remove('entries', live(a.store.data.entries).find(e => e.title === 'Phone').id);
    await a.engine.flush();
    await b.engine.flush();
    expect(titles(b)).toEqual(['Books', 'Rent']);
    expect(cloudTitles(cloud)).toEqual(['Books', 'Rent']);
    await restart(a);
    expect(titles(a)).toEqual(['Books', 'Rent']);
  });

  it('a deletion travels and is not resurrected', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    a.store.remove('entries', live(a.store.data.entries).find(e => e.title === 'Phone').id);
    await a.engine.flush();
    await restart(b);
    await b.engine.flush();
    await restart(a);
    expect(titles(b)).toEqual(['Rent']);
    expect(titles(a)).toEqual(['Rent']);
  });

  it('signing in again without a sync state merges instead of overwriting', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    await b.engine.logout();
    b.store.add('entries', makeEntry({ date: '2026-10-21', title: 'Books', amount: 2000, accountId: accountOf(b) }));
    a.store.add('entries', makeEntry({ date: '2026-10-20', title: 'Gift', amount: 5000, accountId: accountOf(a) }));
    await a.engine.flush();
    const writes = cloud.writes;
    const login = await b.engine.login('en');
    expect(login.synced.outcome).toBe('merged');
    expect(cloud.writes).toBe(writes);
    expect(titles(b)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
    await b.engine.flush();
    expect(cloudTitles(cloud)).toEqual(['Books', 'Gift', 'Phone', 'Rent']);
  });

  it('two different budgets meeting are merged, nothing is asked or lost', async () => {
    const cloud = fakeCloud();
    const a = await start(device(cloud, { initial: seed() }));
    await a.engine.flush();
    const other = seed();
    other.entries = [makeEntry({ date: '2026-10-07', title: 'Cinema', amount: 1200, accountId: other.accounts[0].id })];
    const b = await start(device(cloud, { initial: other }));
    expect(titles(b)).toEqual(['Cinema', 'Phone', 'Rent']);
    await b.engine.flush();
    expect(cloudTitles(cloud)).toEqual(['Cinema', 'Phone', 'Rent']);
  });

  it('replacing the budget on one device (restore, demo, reset) reaches the other', async () => {
    const cloud = fakeCloud();
    const { a, b } = await shared(cloud);
    const fresh = seed();
    fresh.entries = [makeEntry({ date: '2026-10-09', title: 'Only', amount: 100, accountId: fresh.accounts[0].id })];
    a.store.replaceAll(fresh);
    await a.engine.flush();
    await restart(b);
    expect(titles(b)).toEqual(['Only']);
    expect(b.store.data.datasetId).toBe(a.store.data.datasetId);
    // A reset leaves tombstones that travel too.
    b.store.replaceAll({ settings: { language: 'en' } });
    await b.engine.flush();
    await restart(a);
    expect(titles(a)).toEqual([]);
  });

  it('a spare cloud copy is merged in before it is removed', async () => {
    const cloud = fakeCloud();
    const { a } = await shared(cloud);
    const spare = JSON.parse(cloud.file.content);
    spare.entries.push(makeEntry({ date: '2026-10-22', title: 'Taxi', amount: 1500, accountId: spare.accounts[0].id }));
    const realMeta = a.bridge.meta;
    const realDownload = a.bridge.download;
    const removed = [];
    a.bridge.meta = async () => ({ ...(await realMeta()), duplicates: removed.length ? [] : ['file-2'] });
    a.bridge.download = async (id) => (id === 'file-2' ? { ok: true, content: JSON.stringify(spare), version: '1', fileId: 'file-2' } : realDownload(id));
    a.bridge.remove = async (ids) => { removed.push(...ids); return { ok: true }; };
    await a.engine.sync('interval');
    expect(titles(a)).toContain('Taxi');
    expect(removed).toEqual([]);
    await a.engine.flush();
    expect(cloudTitles(cloud)).toContain('Taxi');
    expect(removed).toEqual(['file-2']);
  });

  it('plan generated on two devices before syncing does not double', async () => {
    const cloud = fakeCloud();
    const data = seed();
    data.templates.push(makeTemplate({
      title: 'Rent', amount: 95000, accountId: data.accounts[0].id,
      schedule: { freq: 'monthly', day: 1, startDate: '2026-10-01' }
    }));
    const a = await start(device(cloud, { initial: data }));
    await a.engine.flush();
    const b = await start(device(cloud));
    a.store.generate();
    b.store.generate();
    await a.engine.flush();
    await b.engine.flush();
    await restart(a);
    const occurrences = (d) => live(d.store.data.entries).filter(e => e.templateId).map(e => e.occurrence).sort();
    expect(occurrences(a)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
    expect(occurrences(b)).toEqual(occurrences(a));
  });
});

describe('dropped sign-in', () => {
  it('a restart after a dropped sign-in still asks to sign in', async () => {
    const cloud = fakeCloud();
    const store = new Store(memoryAdapter(JSON.stringify(seed())), { today: () => '2026-10-05' });
    const bridge = cloud.bridge();
    bridge.status = async () => ({ configured: true, loggedIn: false, email: '', signInNeeded: { reason: 'expired', email: 'owner@example.com' } });
    const engine = new SyncEngine({ store, bridge });
    await engine.init({ auto: false });
    expect(engine.state.status).toBe('reauth');
    expect(engine.state.reauthReason).toBe('expired');
    expect(engine.state.email).toBe('owner@example.com');
  });

  it('a device that never synced or signed out stays quiet', async () => {
    const cloud = fakeCloud();
    const store = new Store(memoryAdapter(JSON.stringify(seed())), { today: () => '2026-10-05' });
    const bridge = cloud.bridge();
    bridge.status = async () => ({ configured: true, loggedIn: false, email: '', signInNeeded: null });
    const engine = new SyncEngine({ store, bridge });
    await engine.init({ auto: false });
    expect(engine.state.status).toBe('off');
    expect(engine.state.reauthReason).toBeNull();
  });

  it('a sync refused for a missing Drive permission says so, and signing in clears it', async () => {
    const cloud = fakeCloud();
    const d = await start(device(cloud, { initial: seed() }));
    d.engine.bridge.meta = async () => ({ ok: false, error: 'drive_scope_missing', reauth: true, reason: 'drive_scope' });
    const result = await d.engine.sync('manual');
    expect(result.ok).toBe(false);
    expect(d.engine.state.status).toBe('reauth');
    expect(d.engine.state.reauthReason).toBe('drive_scope');
    expect(d.engine.loggedIn).toBe(false);

    d.engine.bridge.meta = async () => ({ ok: true, exists: false });
    const login = await d.engine.login('en');
    expect(login.ok).toBe(true);
    expect(d.engine.state.status).toBe('idle');
    expect(d.engine.state.reauthReason).toBeNull();
  });
});
