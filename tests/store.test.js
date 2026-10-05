import { describe, it, expect } from 'vitest';
import { Store, memoryAdapter } from '../src/store.js';
import { makeAccount, makeEntry, makeTemplate } from '../src/model.js';
import { suggestAllocation } from '../src/allocation.js';

const fixedToday = () => '2026-10-05';

function freshStore(initial = null) {
  const adapter = memoryAdapter(initial);
  const store = new Store(adapter, { today: fixedToday });
  return { store, adapter };
}

describe('store persistence', () => {
  it('never overwrites an unreadable file', () => {
    const { store, adapter } = freshStore('{broken json');
    expect(store.loadError).toBeTruthy();
    store.updateSettings({ theme: 'light' });
    expect(adapter.peek()).toBe('{broken json');
  });

  it('saves every change and reloads it', () => {
    const { store, adapter } = freshStore();
    store.setupFresh({ language: 'en', accounts: [{ name: 'Main', openingBalance: 1000 }], trackingStart: '2026-10-01' });
    const again = new Store(memoryAdapter(adapter.peek()), { today: fixedToday });
    expect(again.list('accounts')[0].name).toBe('Main');
    expect(again.settings.trackingStart).toBe('2026-10-01');
    expect(again.list('categories').length).toBeGreaterThan(5);
    expect(again.settings.defaultIncomeAccountId).toBe(again.list('accounts')[0].id);
  });

  it('removing keeps a tombstone and bumps updatedAt', () => {
    const { store } = freshStore();
    const acc = store.add('accounts', makeAccount({ name: 'A' }));
    const before = acc.updatedAt;
    store.remove('accounts', acc.id);
    expect(store.list('accounts')).toHaveLength(0);
    const raw = store.data.accounts.find(a => a.id === acc.id);
    expect(raw.deleted).toBe(true);
    expect(raw.updatedAt >= before).toBe(true);
  });
});

describe('undo', () => {
  it('restores edits, revives deletions and tombstones new records', () => {
    const { store } = freshStore();
    const a = store.add('accounts', makeAccount({ name: 'A' }));
    const b = store.add('accounts', makeAccount({ name: 'B' }));
    const snap = store.snapshot();

    store.update('accounts', a.id, { name: 'A2' });
    store.remove('accounts', b.id);
    const c = store.add('accounts', makeAccount({ name: 'C' }));

    store.restore(snap);
    const names = store.list('accounts').map(x => x.name).sort();
    expect(names).toEqual(['A', 'B']);
    expect(store.data.accounts.find(x => x.id === c.id).deleted).toBe(true);
  });
});

describe('statuses', () => {
  it('done, undo to reserved when money was set aside, otherwise to planned', () => {
    const { store } = freshStore();
    const e1 = store.add('entries', makeEntry({ date: '2026-10-06', amount: 100 }));
    store.setStatus(e1.id, 'reserved');
    store.setStatus(e1.id, 'done', { amount: 120 });
    expect(store.find('entries', e1.id)).toMatchObject({ status: 'done', amount: 120, plannedAmount: 100 });
    store.unmarkDone(e1.id);
    expect(store.find('entries', e1.id).status).toBe('reserved');

    const e2 = store.add('entries', makeEntry({ date: '2026-10-06', amount: 100 }));
    store.setStatus(e2.id, 'done');
    store.unmarkDone(e2.id);
    expect(store.find('entries', e2.id).status).toBe('planned');
  });
});

describe('templates', () => {
  it('generates three months ahead and only once', () => {
    const { store } = freshStore();
    store.setupFresh({ trackingStart: '2026-10-01' });
    store.saveTemplate(makeTemplate({ title: 'Rent', amount: 95000, schedule: { freq: 'monthly', day: 1, startDate: '2026-10-01' } }));
    const dates = store.list('entries').map(e => e.date).sort();
    expect(dates).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
    expect(store.generate()).toBe(0);
  });

  it('edits flow into future planned entries only', () => {
    const { store } = freshStore();
    store.setupFresh({ trackingStart: '2026-10-01' });
    const t = makeTemplate({ title: 'Rent', amount: 95000, schedule: { freq: 'monthly', day: 1, startDate: '2026-10-01' } });
    store.saveTemplate(t);
    const october = store.list('entries').find(e => e.date === '2026-10-01');
    store.setStatus(october.id, 'done');

    store.saveTemplate({ ...store.find('templates', t.id), amount: 99000 }, { applyToFuture: true });
    const amounts = store.list('entries').sort((x, y) => x.date < y.date ? -1 : 1).map(e => e.amount);
    expect(amounts).toEqual([95000, 99000, 99000, 99000]);
  });

  it('a schedule change regenerates the future without duplicates', () => {
    const { store } = freshStore();
    store.setupFresh({ trackingStart: '2026-10-01' });
    const t = makeTemplate({ title: 'Gym', amount: 3000, schedule: { freq: 'monthly', day: 1, startDate: '2026-10-01' } });
    store.saveTemplate(t);
    store.saveTemplate(
      { ...store.find('templates', t.id), schedule: { ...t.schedule, day: 15 } },
      { scheduleChanged: true }
    );
    const dates = store.list('entries').map(e => e.date).sort();
    // 1 Oct is in the past (today is 5 Oct) and stays; the future moves to the 15th.
    expect(dates).toEqual(['2026-10-01', '2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15']);
  });
});

describe('allocation through the store', () => {
  it('reserves covered bills and creates transfers', () => {
    const { store } = freshStore();
    store.setupFresh({ trackingStart: '2026-10-01', accounts: [{ name: 'Main', openingBalance: 50000 }] });
    const main = store.list('accounts')[0];
    const env = store.add('accounts', makeAccount({ name: 'Bills', parentId: main.id }));
    const bill = store.add('entries', makeEntry({ date: '2026-10-10', amount: 20000, accountId: env.id }));

    const plan = suggestAllocation(store.data, main.id, '2026-10-31');
    store.applyAllocation(plan);
    expect(store.find('entries', bill.id).status).toBe('reserved');
    const transfer = store.list('entries').find(e => e.type === 'transfer');
    expect(transfer).toMatchObject({ amount: 20000, accountId: main.id, toAccountId: env.id });
  });
});
