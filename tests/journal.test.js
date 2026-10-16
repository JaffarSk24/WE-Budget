import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store, memoryAdapter, store as appStore } from '../src/store.js';
import { makeAccount, makeCategory, makeEntry, makeTemplate, emptyData } from '../src/model.js';
import {
  diffData, describeChange, describeBatch, revertBatch, restoreVersion, pruneIds, makeItems, groupBatches,
  groupByDay, filterBatches, JournalTracker, collectionGroup, fieldRows, strongestSource
} from '../src/journal.js';
import { Journal, memoryBackend } from '../src/journal-log.js';

const T0 = '2026-10-01T08:00:00.000Z';
const T1 = '2026-10-02T09:30:00.000Z';
const T2 = '2026-10-03T10:00:00.000Z';
const NOW = '2026-10-04T12:00:00.000Z';

function doc(fields = {}) {
  return { ...emptyData(), ...fields };
}

function rec(make, fields, at = T0) {
  return { ...make(fields), createdAt: at, updatedAt: at };
}

let savedLang;
beforeAll(() => {
  savedLang = appStore.data.settings.language;
  appStore.data.settings.language = 'en';
  appStore.data.settings.currency = 'EUR';
});
afterAll(() => { appStore.data.settings.language = savedLang; });

describe('diffData', () => {
  const acc = rec(makeAccount, { name: 'Main' });
  const rent = rec(makeEntry, { date: '2026-10-05', title: 'Rent', amount: 90000, accountId: acc.id });

  it('finds added, edited, deleted and restored records only', () => {
    const gone = rec(makeCategory, { name: 'Hobby' });
    const back = { ...rec(makeCategory, { name: 'Pets' }), deleted: true };
    const before = doc({ accounts: [acc], entries: [rent], categories: [gone, back] });
    const fresh = rec(makeEntry, { date: '2026-10-06', title: 'Gym', amount: 3000 }, T1);
    const after = doc({
      accounts: [acc],
      entries: [{ ...rent, amount: 95000, updatedAt: T1 }, fresh],
      categories: [{ ...gone, deleted: true, updatedAt: T1 }, { ...back, deleted: false, updatedAt: T1 }]
    });
    const changes = diffData(before, after);
    const ops = changes.map(c => `${c.collection}:${c.op}`).sort();
    expect(ops).toEqual(['categories:delete', 'categories:undelete', 'entries:add', 'entries:edit']);
    const edit = changes.find(c => c.op === 'edit');
    expect(edit.fields).toEqual(['amount']);
    expect(edit.before.amount).toBe(90000);
    expect(edit.after.amount).toBe(95000);
  });

  it('ignores a new updatedAt without new content and generation bookkeeping', () => {
    const tpl = rec(makeTemplate, { title: 'Rent', amount: 90000, generatedThrough: '2026-12-31' });
    const before = doc({ entries: [rent], templates: [tpl] });
    const after = doc({
      entries: [{ ...rent, updatedAt: T1 }],
      templates: [{ ...tpl, generatedThrough: '2027-01-31', updatedAt: T1 }]
    });
    expect(diffData(before, after)).toEqual([]);
  });

  it('works for any collection it is given', () => {
    const s = { id: 'sc-1', name: 'Plan B', createdAt: T0, updatedAt: T0, deleted: false };
    const changes = diffData({ scenarios: [s] }, { scenarios: [{ ...s, name: 'Plan C', updatedAt: T1 }] }, ['scenarios']);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ collection: 'scenarios', op: 'edit', fields: ['name'] });
    expect(collectionGroup('scenarios')).toBe('other');
    expect(collectionGroup('entries')).toBe('payments');
  });

  it('the tracker compares only records whose updatedAt moved', () => {
    const tracker = new JournalTracker(['entries']);
    const data = doc({ entries: [{ ...rent }] });
    tracker.reset(data);
    // Changed in place without a new updatedAt: not an edit (bookkeeping).
    data.entries[0].amount = 1;
    expect(tracker.diff(data)).toEqual([]);
    data.entries[0].updatedAt = T1;
    expect(tracker.diff(data)).toHaveLength(1);
    expect(tracker.diff(data)).toEqual([]);
  });
});

describe('describeChange', () => {
  const acc = rec(makeAccount, { name: 'Main' });
  const data = doc({ accounts: [acc] });

  it('shows an amount edit with the old and the new value', () => {
    const before = rec(makeEntry, { date: '2026-10-05', title: 'Rent', amount: 90000, accountId: acc.id });
    const [item] = makeItems(diffData(doc({ entries: [before] }), doc({ entries: [{ ...before, amount: 95000, updatedAt: T1 }] })));
    expect(describeChange(item, data)).toBe('Payment "Rent" 950.00€: amount 900.00€ → 950.00€');
    expect(fieldRows(item, data)).toEqual([{ field: 'amount', label: 'Amount', from: '900.00€', to: '950.00€' }]);
  });

  it('says a payment was marked done', () => {
    const before = rec(makeEntry, { date: '2026-10-05', title: 'Rent', amount: 90000 });
    const after = { ...before, status: 'done', doneAt: T1, updatedAt: T1 };
    const [item] = makeItems(diffData(doc({ entries: [before] }), doc({ entries: [after] })));
    expect(describeChange(item, data)).toBe('Payment "Rent" 900.00€: marked done');
  });

  it('names deleted and added records and resolves ids to names', () => {
    const hobby = rec(makeCategory, { name: 'Hobby' });
    const [del] = makeItems(diffData(doc({ categories: [hobby] }), doc({ categories: [{ ...hobby, deleted: true, updatedAt: T1 }] })));
    expect(describeChange(del, data)).toBe('Deleted category "Hobby"');
    const other = rec(makeAccount, { name: 'Savings' });
    const e = rec(makeEntry, { date: '2026-10-05', title: 'Salary', type: 'income', amount: 200000, accountId: acc.id });
    const [moved] = makeItems(diffData(doc({ entries: [e] }), doc({ entries: [{ ...e, accountId: other.id, updatedAt: T1 }] })));
    expect(describeChange(moved, doc({ accounts: [acc, other] }))).toBe('Income "Salary" 2,000.00€: account Main → Savings');
    const [added] = makeItems(diffData(doc(), doc({ accounts: [other] })));
    expect(describeChange(added, data)).toBe('Added account "Savings"');
  });

  it('sums up a bulk step in one line', () => {
    const a = rec(makeEntry, { date: '2026-10-05', title: 'Rent', amount: 90000 });
    const b = rec(makeEntry, { date: '2026-10-06', title: 'Gym', amount: 3000 });
    const c = rec(makeEntry, { date: '2026-10-07', title: 'Phone', amount: 1500 });
    const done = (x) => ({ ...x, status: 'done', updatedAt: T1 });
    const items = makeItems(diffData(doc({ entries: [a, b, c] }), doc({ entries: [done(a), done(b), done(c)] })));
    const [batch] = groupBatches(items);
    expect(describeBatch(batch, data)).toBe('Payment "Rent" 900.00€: marked done and 2 more changes');
  });
});

describe('revertBatch', () => {
  const rent = rec(makeEntry, { date: '2026-10-05', title: 'Rent', amount: 90000 });

  function step(before, after, at = T1) {
    return makeItems(diffData(before, after), { at });
  }

  it('brings an edit back as a new change', () => {
    const after = doc({ entries: [{ ...rent, amount: 95000, updatedAt: T1 }] });
    const items = step(doc({ entries: [rent] }), after);
    const { patches, conflicts } = revertBatch(after, items, { now: NOW });
    expect(conflicts).toEqual([]);
    expect(patches).toHaveLength(1);
    expect(patches[0].record).toMatchObject({ id: rent.id, amount: 90000, updatedAt: NOW, deleted: false });
  });

  it('soft deletes an added record and brings back a deleted one', () => {
    const gym = rec(makeEntry, { date: '2026-10-06', title: 'Gym', amount: 3000 }, T1);
    const after = doc({ entries: [{ ...rent, deleted: true, updatedAt: T1 }, gym] });
    const items = step(doc({ entries: [rent] }), after);
    const { patches } = revertBatch(after, items, { now: NOW });
    const byId = Object.fromEntries(patches.map(p => [p.id, p.record]));
    expect(byId[gym.id]).toMatchObject({ deleted: true, updatedAt: NOW, title: 'Gym' });
    expect(byId[rent.id]).toMatchObject({ deleted: false, updatedAt: NOW, amount: 90000 });
  });

  it('takes back a bulk step record by record', () => {
    const others = [1, 2, 3].map(n => rec(makeEntry, { date: `2026-10-0${n}`, title: `Item ${n}`, amount: n * 100 }));
    const after = doc({ entries: others.map(e => ({ ...e, status: 'done', updatedAt: T1 })) });
    const items = step(doc({ entries: others }), after);
    const { patches } = revertBatch(after, items, { now: NOW });
    expect(patches.map(p => p.record.status)).toEqual(['planned', 'planned', 'planned']);
  });

  it('keeps generation bookkeeping as it is now', () => {
    const tpl = rec(makeTemplate, { title: 'Rent', amount: 90000, generatedThrough: '2026-12-31' });
    const edited = { ...tpl, amount: 95000, updatedAt: T1 };
    const items = step(doc({ templates: [tpl] }), doc({ templates: [edited] }));
    const later = doc({ templates: [{ ...edited, generatedThrough: '2027-01-31' }] });
    const { patches, conflicts } = revertBatch(later, items, { now: NOW });
    expect(conflicts).toEqual([]);
    expect(patches[0].record).toMatchObject({ amount: 90000, generatedThrough: '2027-01-31' });
  });

  it('reports a record changed again later and leaves it out unless forced', () => {
    const after = doc({ entries: [{ ...rent, amount: 95000, updatedAt: T1 }] });
    const items = step(doc({ entries: [rent] }), after);
    const later = doc({ entries: [{ ...rent, amount: 99000, title: 'Rent and parking', updatedAt: T2 }] });
    const soft = revertBatch(later, items, { now: NOW });
    expect(soft.patches).toEqual([]);
    expect(soft.conflicts).toHaveLength(1);
    expect(soft.conflicts[0].current.amount).toBe(99000);
    const forced = revertBatch(later, items, { now: NOW, force: true });
    expect(forced.patches[0].record).toMatchObject({ amount: 90000, title: 'Rent' });
  });

  it('has nothing to do when the records are already back', () => {
    const after = doc({ entries: [{ ...rent, amount: 95000, updatedAt: T1 }] });
    const items = step(doc({ entries: [rent] }), after);
    const back = doc({ entries: [{ ...rent, updatedAt: T2 }] });
    expect(revertBatch(back, items, { now: NOW })).toMatchObject({ patches: [], conflicts: [], unchanged: 1 });
  });

  it('restores one version of a record', () => {
    const v2 = { ...rent, amount: 95000, updatedAt: T1 };
    const [item] = step(doc({ entries: [rent] }), doc({ entries: [v2] }));
    const now = doc({ entries: [{ ...rent, amount: 99000, updatedAt: T2 }] });
    expect(restoreVersion(now, item, { now: NOW }).record).toMatchObject({ amount: 95000, updatedAt: NOW });
    expect(restoreVersion(doc({ entries: [v2] }), item)).toBe(null);
  });
});

describe('pruning', () => {
  function batchAt(at, n) {
    const changes = Array.from({ length: n }, (_, i) => ({ collection: 'entries', recordId: `r${i}`, op: 'add', before: null, after: { id: `r${i}` }, fields: [] }));
    return makeItems(changes, { at });
  }

  it('drops steps older than 90 days', () => {
    const old = batchAt('2026-06-01T10:00:00.000Z', 2);
    const fresh = batchAt('2026-09-20T10:00:00.000Z', 2);
    expect(pruneIds([...old, ...fresh], NOW).sort()).toEqual(old.map(i => i.id).sort());
  });

  it('keeps at most the limit, dropping whole steps and never the newest', () => {
    const a = batchAt('2026-10-01T10:00:00.000Z', 3);
    const b = batchAt('2026-10-02T10:00:00.000Z', 3);
    const c = batchAt('2026-10-03T10:00:00.000Z', 3);
    expect(pruneIds([...a, ...b, ...c], NOW, { maxItems: 5 }).sort()).toEqual([...a, ...b].map(i => i.id).sort());
    const huge = batchAt('2026-10-03T10:00:00.000Z', 8);
    expect(pruneIds(huge, NOW, { maxItems: 5 })).toEqual([]);
  });
});

describe('reading the journal', () => {
  it('groups steps by local day, newest first, and filters them', () => {
    const e = rec(makeEntry, { date: '2026-10-05', title: 'Rent', amount: 90000 });
    const c = rec(makeCategory, { name: 'Hobby' });
    const one = makeItems(diffData(doc(), doc({ entries: [e] })), { at: T0, source: 'local' });
    const two = makeItems(diffData(doc(), doc({ categories: [c] })), { at: T2, source: 'sync' });
    const batches = groupBatches([...one, ...two]);
    expect(batches.map(b => b.source)).toEqual(['sync', 'local']);
    expect(groupByDay(batches)).toHaveLength(2);
    const data = doc();
    expect(filterBatches(batches, { group: 'payments' }, data)).toHaveLength(1);
    expect(filterBatches(batches, { source: 'sync' }, data)[0].items[0].collection).toBe('categories');
    expect(filterBatches(batches, { query: 'hob' }, data)).toHaveLength(1);
    expect(strongestSource(['auto', 'local'])).toBe('local');
    expect(strongestSource(['local', 'sync'])).toBe('sync');
  });
});

describe('store wiring', () => {
  // One look per test step: the journal compares when it is asked to.
  function setup() {
    const s = new Store(memoryAdapter(), { today: () => '2026-10-05' });
    const backend = memoryBackend();
    const j = new Journal(backend, { defer: () => {} }).attach(s);
    return { s, j, backend };
  }

  const tick = () => new Promise(r => setTimeout(r, 2));

  it('records a step per action with its source', async () => {
    const { s, j } = setup();
    const acc = s.add('accounts', makeAccount({ name: 'Main' }));
    s.add('entries', makeEntry({ date: '2026-10-05', title: 'Rent', amount: 90000, accountId: acc.id }));
    const first = j.capture();
    expect(first).toHaveLength(2);
    expect(new Set(first.map(i => i.batchId)).size).toBe(1);
    expect(first[0].source).toBe('local');

    await tick();
    const snap = s.snapshot();
    s.remove('accounts', acc.id);
    j.capture();
    await tick();
    s.restore(snap);
    const undo = j.capture();
    expect(undo).toHaveLength(1);
    expect(undo[0]).toMatchObject({ source: 'restore', op: 'undelete', collection: 'accounts' });

    await tick();
    const remote = s.snapshot();
    remote.accounts[0] = { ...remote.accounts[0], name: 'Main card', updatedAt: new Date(Date.now() + 1000).toISOString() };
    s.applySynced(remote);
    expect(j.capture()[0]).toMatchObject({ source: 'sync', op: 'edit', fields: ['name'] });
  });

  it('marks generated payments as automatic and skips steps that change nothing', () => {
    const { s, j } = setup();
    const acc = s.add('accounts', makeAccount({ name: 'Main' }));
    j.capture();
    s.saveTemplate(makeTemplate({ title: 'Gym', amount: 3000, accountId: acc.id, schedule: { freq: 'monthly', day: 10, startDate: '2026-10-01' } }));
    const step = j.capture();
    expect(step[0].source).toBe('local');
    expect(step.some(i => i.collection === 'entries')).toBe(true);
    s.generate();
    expect(j.capture()).toEqual([]);
  });

  it('an undo from the journal is a new change that sync carries', async () => {
    const { s, j, backend } = setup();
    const e = s.add('entries', makeEntry({ date: '2026-10-05', title: 'Rent', amount: 90000 }));
    j.capture();
    await tick();
    s.update('entries', e.id, { amount: 95000 });
    const items = j.capture();
    await j.flush();
    expect(await backend.all()).toHaveLength(2);
    await tick();
    const { patches } = revertBatch(s.data, items);
    s.applyPatches(patches);
    const now = s.find('entries', e.id);
    expect(now.amount).toBe(90000);
    expect(now.updatedAt > items[0].after.updatedAt).toBe(true);
    expect(j.capture()[0]).toMatchObject({ source: 'restore', op: 'edit' });
  });

  it('replacing the budget is one step, and an unreadable file records nothing', () => {
    const { s, j } = setup();
    s.replaceAll({ accounts: [makeAccount({ name: 'A' }), makeAccount({ name: 'B' })], settings: {} });
    const step = j.capture();
    expect(step).toHaveLength(2);
    expect(step[0].source).toBe('import');

    const broken = new Store(memoryAdapter('{oops'));
    const jb = new Journal(memoryBackend(), { defer: () => {} }).attach(broken);
    broken.add('accounts', makeAccount({ name: 'X' }));
    expect(jb.capture()).toEqual([]);
  });

  it('a click on a large budget stays cheap', () => {
    const { s, j } = setup();
    const many = Array.from({ length: 5000 }, (_, i) => makeEntry({ date: '2026-10-05', title: `E${i}`, amount: i }));
    s.addMany('entries', many);
    j.capture();
    const started = Date.now();
    for (let i = 0; i < 20; i++) {
      s.update('entries', many[i].id, { amount: 1 + i });
      j.capture();
    }
    expect((Date.now() - started) / 20).toBeLessThan(50);
  });
});
