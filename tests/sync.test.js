import { describe, it, expect } from 'vitest';
import { Store, memoryAdapter } from '../src/store.js';
import { SyncEngine } from '../src/sync/engine.js';
import { mergeBudgets, decideDataset, dedupeOccurrences } from '../src/sync/merge.js';
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

function device(cloud, { today = '2026-10-05', ask = async () => null, initial = null } = {}) {
  const store = new Store(memoryAdapter(initial ? JSON.stringify(initial) : null), { today: () => today });
  const engine = new SyncEngine({ store, bridge: cloud.bridge(), ask, afterApply: () => store.generate() });
  return { store, engine };
}

async function start(d) {
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

// Timestamps must move forward between edits made in the same millisecond.
const tick = () => new Promise(r => setTimeout(r, 3));

describe('merge rules', () => {
  it('newer record wins, records known on one side are kept, both sides converge', () => {
    const a = seed();
    const b = JSON.parse(JSON.stringify(a));
    a.entries[0] = { ...a.entries[0], amount: 99000, updatedAt: '2026-10-05T10:00:00.000Z' };
    b.entries[1] = { ...b.entries[1], title: 'Mobile', updatedAt: '2026-10-05T11:00:00.000Z' };
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
    a.entries[0] = { ...a.entries[0], deleted: true, updatedAt: '2026-10-05T12:00:00.000Z' };
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

  it('decides between merging, taking one side and asking', () => {
    const a = seed();
    const b = seed();
    expect(decideDataset(a, { ...a }, {})).toBe('merge');
    expect(decideDataset(emptyData(), a, {})).toBe('take-remote');
    expect(decideDataset(a, emptyData(), {})).toBe('keep-local');
    expect(decideDataset(a, b, {})).toBe('ask');
    expect(decideDataset(a, b, { datasetId: b.datasetId })).toBe('keep-local');
    expect(decideDataset(a, b, { datasetId: a.datasetId })).toBe('take-remote');
  });
});

describe('two devices', () => {
  it('a second device signing in gets the budget from the cloud', async () => {
    const cloud = fakeCloud();
    const imac = await start(device(cloud, { initial: seed() }));
    expect(cloud.file).not.toBe(null);
    const macbook = await start(device(cloud));
    expect(live(macbook.store.data.entries).map(e => e.title).sort()).toEqual(['Phone', 'Rent']);
    expect(macbook.store.data.datasetId).toBe(imac.store.data.datasetId);
  });

  it('edits made on both sides end up on both sides', async () => {
    const cloud = fakeCloud();
    const a = await start(device(cloud, { initial: seed() }));
    const b = await start(device(cloud));

    await tick();
    const rent = live(a.store.data.entries).find(e => e.title === 'Rent');
    a.store.setStatus(rent.id, 'done');
    await tick();
    const phone = live(b.store.data.entries).find(e => e.title === 'Phone');
    b.store.update('entries', phone.id, { amount: 3000 });
    b.store.add('entries', makeEntry({ date: '2026-10-20', title: 'Gift', amount: 5000, accountId: b.store.list('accounts')[0].id }));

    await a.engine.sync('manual');
    await b.engine.sync('manual');
    await a.engine.sync('manual');

    const view = (d) => live(d.store.data.entries).map(e => `${e.title}:${e.amount}:${e.status}`).sort();
    expect(view(a)).toEqual(['Gift:5000:planned', 'Phone:3000:planned', 'Rent:95000:done']);
    expect(view(b)).toEqual(view(a));
  });

  it('a write that loses a race is merged back on the next cycle', async () => {
    const cloud = fakeCloud();
    const a = await start(device(cloud, { initial: seed() }));
    const b = await start(device(cloud));
    await tick();

    // Both change something, then both upload without seeing each other:
    // B overwrites the cloud copy that A just wrote.
    a.store.update('entries', live(a.store.data.entries)[0].id, { title: 'Rent A' });
    b.store.update('entries', live(b.store.data.entries)[1].id, { title: 'Phone B' });
    await a.engine.sync('manual');
    const bridge = b.engine.bridge;
    const realMeta = bridge.meta;
    bridge.meta = async () => ({ ok: true, exists: true, fileId: 'file-1', version: (await bridge.getState()).version });
    await b.engine.sync('manual');
    bridge.meta = realMeta;

    // A notices a version it has not seen, merges and re-uploads; B follows.
    await a.engine.sync('manual');
    await b.engine.sync('manual');
    const titles = (d) => live(d.store.data.entries).map(e => e.title).sort();
    expect(titles(a)).toEqual(['Phone B', 'Rent A']);
    expect(titles(b)).toEqual(['Phone B', 'Rent A']);
  });

  it('a deletion travels and is not resurrected', async () => {
    const cloud = fakeCloud();
    const a = await start(device(cloud, { initial: seed() }));
    const b = await start(device(cloud));
    await tick();
    const phone = live(a.store.data.entries).find(e => e.title === 'Phone');
    a.store.remove('entries', phone.id);
    await a.engine.sync('manual');
    await b.engine.sync('manual');
    await a.engine.sync('manual');
    expect(live(b.store.data.entries).map(e => e.title)).toEqual(['Rent']);
    expect(live(a.store.data.entries).map(e => e.title)).toEqual(['Rent']);
  });

  it('plan generated on two devices before syncing does not double', async () => {
    const cloud = fakeCloud();
    const data = seed();
    data.templates.push(makeTemplate({
      title: 'Rent', amount: 95000, accountId: data.accounts[0].id,
      schedule: { freq: 'monthly', day: 1, startDate: '2026-10-01' }
    }));
    const a = await start(device(cloud, { initial: data }));
    const b = await start(device(cloud));
    a.store.generate();
    b.store.generate();
    await a.engine.sync('manual');
    await b.engine.sync('manual');
    await a.engine.sync('manual');
    const occurrences = (d) => live(d.store.data.entries).filter(e => e.templateId).map(e => e.occurrence).sort();
    expect(occurrences(a)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
    expect(occurrences(b)).toEqual(occurrences(a));
  });

  it('replacing the budget on one device replaces it on the other', async () => {
    const cloud = fakeCloud();
    const a = await start(device(cloud, { initial: seed() }));
    const b = await start(device(cloud));
    const fresh = seed();
    fresh.entries = fresh.entries.slice(0, 1);
    a.store.replaceAll(fresh);
    await a.engine.sync('manual');
    await b.engine.sync('manual');
    expect(b.store.data.datasetId).toBe(a.store.data.datasetId);
    expect(live(b.store.data.entries)).toHaveLength(1);
  });

  it('two different budgets meeting for the first time are never mixed', async () => {
    const cloud = fakeCloud();
    await start(device(cloud, { initial: seed() }));
    const other = seed();
    other.entries = [];
    const asked = [];
    const b = await start(device(cloud, { initial: other, ask: async (info) => { asked.push(info); return 'take-remote'; } }));
    expect(asked).toHaveLength(1);
    expect(asked[0].remote.entries).toBe(2);
    expect(live(b.store.data.entries)).toHaveLength(2);
  });

  it('background cycles do not ask; the conflict waits for the owner', async () => {
    const cloud = fakeCloud();
    await start(device(cloud, { initial: seed() }));
    let asked = 0;
    const b = device(cloud, { initial: seed(), ask: async () => { asked++; return null; } });
    await b.engine.init({ auto: false });
    expect(asked).toBe(1);
    const r = await b.engine.sync('interval');
    expect(r.outcome).toBe('conflict');
    expect(asked).toBe(1);
  });

  it('closing the app uploads unsent changes and nothing else', async () => {
    const cloud = fakeCloud();
    const a = await start(device(cloud, { initial: seed() }));
    const writes = cloud.writes;
    expect((await a.engine.flush()).outcome).toBe('clean');
    a.store.update('entries', live(a.store.data.entries)[0].id, { note: 'paid by card' });
    await a.engine.flush();
    expect(cloud.writes).toBe(writes + 1);
  });
});
