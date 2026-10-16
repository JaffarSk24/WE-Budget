import { describe, it, expect } from 'vitest';
import { chargeHistory, monthlyEquivalent, nextCharge, priceChange, recurringOverview, yearlyCost } from '../src/ledger.js';
import { emptyData, makeCategory, makeEntry, makeTemplate } from '../src/model.js';
import { entryFromTemplate } from '../src/schedule.js';

const TODAY = '2026-10-05';
const tpl = (amount, schedule, f = {}) => makeTemplate({ title: 'X', amount, schedule: { startDate: '2026-01-01', ...schedule }, ...f });

describe('monthly equivalent', () => {
  it('turns every schedule into a cost per month and per year', () => {
    expect(monthlyEquivalent(tpl(1299, { freq: 'monthly', day: 1 }))).toBe(1299);
    expect(yearlyCost(tpl(1299, { freq: 'monthly', day: 1 }))).toBe(15588);
    expect(monthlyEquivalent(tpl(42000, { freq: 'yearly', day: 14 }))).toBe(3500);
    expect(yearlyCost(tpl(42000, { freq: 'yearly', day: 14 }))).toBe(42000);
    expect(monthlyEquivalent(tpl(6000, { freq: 'everyNMonths', interval: 2, day: 12 }))).toBe(3000);
    expect(yearlyCost(tpl(6000, { freq: 'everyNMonths', interval: 3, day: 12 }))).toBe(24000);
  });

  it('weekly payments count 52 times a year for each weekday', () => {
    expect(monthlyEquivalent(tpl(1000, { freq: 'weekly', weekdays: [0] }))).toBe(4333);
    expect(yearlyCost(tpl(1000, { freq: 'weekly', weekdays: [0, 3] }))).toBe(104000);
    // No weekday picked: the start day's weekday, once a week.
    expect(yearlyCost(tpl(1000, { freq: 'weekly' }))).toBe(52000);
  });

  it('a one-off payment is not a recurring cost', () => {
    expect(monthlyEquivalent(tpl(5000, { freq: 'once' }))).toBe(0);
    expect(yearlyCost(tpl(5000, { freq: 'once' }))).toBe(0);
  });
});

describe('price changes', () => {
  const h = amounts => amounts.map((amount, i) => ({ date: `2026-0${i + 1}-22`, amount }));

  it('finds the latest change of price and its percent', () => {
    expect(priceChange(h([999, 999, 1299, 1299]))).toEqual({ from: 999, to: 1299, date: '2026-03-22', percent: 30 });
    expect(priceChange(h([1000, 1200, 900]))).toEqual({ from: 1200, to: 900, date: '2026-03-22', percent: -25 });
  });

  it('no change, one charge or none: nothing to show', () => {
    expect(priceChange(h([999, 999, 999]))).toBe(null);
    expect(priceChange(h([999]))).toBe(null);
    expect(priceChange([])).toBe(null);
  });

  it('the history holds what was charged, oldest first', () => {
    const data = emptyData();
    const t = tpl(1299, { freq: 'monthly', day: 22 });
    data.templates.push(t);
    const done = (day, amount) => ({ ...entryFromTemplate(t, day), amount, status: 'done' });
    data.entries.push(done('2026-03-22', 1299), done('2026-01-22', 999), done('2026-02-22', 999),
      entryFromTemplate(t, '2026-10-22'), { ...done('2026-04-22', 1299), deleted: true });
    expect(chargeHistory(data, t.id).map(x => x.amount)).toEqual([999, 999, 1299]);
    expect(priceChange(chargeHistory(data, t.id)).percent).toBe(30);
  });
});

describe('recurring overview', () => {
  function budget() {
    const data = emptyData();
    const subs = makeCategory({ name: 'Subscriptions' });
    const video = makeCategory({ name: 'Video', parentId: subs.id });
    const car = makeCategory({ name: 'Car' });
    data.categories.push(subs, video, car);
    const streaming = tpl(1299, { freq: 'monthly', day: 22 }, { title: 'Streaming', categoryId: video.id });
    const insurance = tpl(42000, { freq: 'yearly', day: 14, startDate: '2026-12-14' }, { title: 'Insurance', categoryId: car.id });
    const cloud = tpl(3000, { freq: 'yearly', day: 2, startDate: '2026-03-02' }, { title: 'Cloud', categoryId: subs.id });
    data.templates.push(streaming, insurance, cloud,
      tpl(265000, { freq: 'monthly', day: 5 }, { type: 'income' }),
      tpl(5000, { freq: 'monthly', day: 5 }, { isTransit: true }),
      tpl(5000, { freq: 'monthly', day: 5 }, { active: false }),
      tpl(5000, { freq: 'monthly', day: 5, endDate: '2026-06-30' }),
      tpl(5000, { freq: 'once', startDate: '2026-11-01' }),
      tpl(15000, { freq: 'monthly', day: 6 }, { type: 'transfer', goalId: 'g1' }));
    return { data, subs, car, streaming, insurance, cloud };
  }

  it('lists active recurring expenses, the most expensive per year first, with totals', () => {
    const { data } = budget();
    const o = recurringOverview(data, TODAY);
    expect(o.rows.map(r => r.template.title)).toEqual(['Insurance', 'Streaming', 'Cloud']);
    expect(o.yearly).toBe(42000 + 15588 + 3000);
    expect(o.monthly).toBe(3500 + 1299 + 250);
  });

  it('filters by category with its subcategories', () => {
    const { data, subs, car } = budget();
    expect(recurringOverview(data, TODAY, { categoryId: subs.id }).rows.map(r => r.template.title)).toEqual(['Streaming', 'Cloud']);
    expect(recurringOverview(data, TODAY, { categoryId: car.id }).yearly).toBe(42000);
  });

  it('the next charge is the open entry in the plan or the next scheduled day', () => {
    const { data, streaming, cloud } = budget();
    expect(nextCharge(data, cloud, TODAY)).toBe('2027-03-02');
    data.entries.push({ ...entryFromTemplate(streaming, '2026-10-22'), date: '2026-10-24' });
    expect(nextCharge(data, streaming, TODAY)).toBe('2026-10-24');
    data.entries.push(makeEntry({ templateId: streaming.id, date: '2026-09-22', amount: 1299, status: 'done' }));
    const row = recurringOverview(data, TODAY).rows.find(r => r.template.id === streaming.id);
    expect(row.last).toEqual({ date: '2026-09-22', amount: 1299 });
  });

  it('estimated amounts are not price changes', () => {
    const { data, streaming } = budget();
    streaming.amountIsEstimate = true;
    data.entries.push(
      { ...entryFromTemplate(streaming, '2026-08-22'), amount: 1100, status: 'done' },
      { ...entryFromTemplate(streaming, '2026-09-22'), amount: 1400, status: 'done' });
    expect(recurringOverview(data, TODAY).rows.find(r => r.template.id === streaming.id).change).toBe(null);
  });
});
