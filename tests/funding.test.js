import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.js';
import { emptyData, makeAccount, makeEntry, live } from '../src/model.js';
import { accountSummaries } from '../src/ledger.js';

function setup(extra = {}) {
  const data = emptyData();
  const main = makeAccount({ name: 'Main', openingBalance: 100000 });
  const bills = makeAccount({ name: 'Bills', parentId: main.id });
  const pay = makeEntry({ date: '2026-11-10', title: 'Phone', type: 'expense', amount: 2500, accountId: bills.id, ...extra });
  data.accounts.push(main, bills);
  data.entries.push(pay);
  data.settings.trackingStart = '2026-01-01';
  const store = new Store({ load: () => JSON.stringify(data), save: () => {} });
  store.today = () => '2026-11-03';
  return { store, main, bills, pay };
}

const own = (store, id) => accountSummaries(store.data, '2026-11-03').get(id);
const fundings = store => live(store.data.entries).filter(e => e.fundingFor);

describe('money set aside on an envelope', () => {
  it('moves from the account the envelope belongs to', () => {
    const { store, main, bills, pay } = setup();
    store.setStatus(pay.id, 'reserved');
    expect(own(store, bills.id).ownBalance).toBe(2500);
    expect(own(store, bills.id).ownReserved).toBe(2500);
    expect(own(store, main.id).ownBalance).toBe(97500);
    expect(fundings(store)).toHaveLength(1);
  });

  it('goes back when the payment returns to the plan, is cancelled or deleted', () => {
    for (const undo of ['planned', 'cancelled', 'delete']) {
      const { store, bills, pay } = setup();
      store.setStatus(pay.id, 'reserved');
      if (undo === 'delete') store.remove('entries', pay.id);
      else store.setStatus(pay.id, undo);
      expect(own(store, bills.id).ownBalance, undo).toBe(0);
      expect(fundings(store), undo).toHaveLength(0);
    }
  });

  it('stays when the payment is done, which then spends it from the envelope', () => {
    const { store, bills, pay } = setup();
    store.setStatus(pay.id, 'reserved');
    store.setStatus(pay.id, 'done', { today: '2026-11-03' });
    expect(own(store, bills.id).ownBalance).toBe(0);
    expect(fundings(store)).toHaveLength(1);
  });

  it('is not moved twice: by Split income or again after a second set aside', () => {
    const viaSplit = setup({ status: 'reserved', allocationId: 'a1' });
    expect(fundings(viaSplit.store)).toHaveLength(0);
    const { store, pay } = setup();
    store.setStatus(pay.id, 'reserved');
    store.setStatus(pay.id, 'planned');
    store.setStatus(pay.id, 'reserved');
    expect(fundings(store)).toHaveLength(1);
    expect(store.data.entries.filter(e => e.fundingFor)).toHaveLength(1);
  });

  it('is added once on start for payments set aside before, with the same id on every device', () => {
    const a = setup({ status: 'reserved', reservedAt: '2026-11-02T09:00:00.000Z' });
    expect(fundings(a.store)).toHaveLength(1);
    expect(fundings(a.store)[0].id).toBe(`fund-${a.pay.id}`);
    expect(fundings(a.store)[0].date).toBe('2026-11-02');
    expect(own(a.store, a.bills.id).ownBalance).toBe(2500);
  });

  it('leaves payments on a main account alone', () => {
    const { store, main } = setup();
    const p = makeEntry({ date: '2026-11-10', title: 'Rent', type: 'expense', amount: 9000, accountId: main.id });
    store.add('entries', p);
    store.setStatus(p.id, 'reserved');
    expect(fundings(store)).toHaveLength(0);
  });
});
