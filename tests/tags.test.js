import { describe, it, expect } from 'vitest';
import { emptyData, makeAccount, makeCategory, makeEntry, makeTag, makeTemplate, TAG_COLORS } from '../src/model.js';
import { tagSummary, tagPhase, withTag, withoutTag, entryHasTag, tagUsage, sortedTags } from '../src/tags.js';
import { searchEntries, hasActiveFilters } from '../src/search.js';
import { Store, memoryAdapter } from '../src/store.js';

function fixture() {
  const data = emptyData();
  const bank = makeAccount({ name: 'Main' });
  const food = makeCategory({ name: 'Eating out' });
  const travel = makeCategory({ name: 'Travel' });
  const refunds = makeCategory({ name: 'Refunds', type: 'income' });
  const trip = makeTag({ name: 'Weekend in Vienna', color: 'teal', budget: 60000, startDate: '2026-10-09', endDate: '2026-10-11' });
  const other = makeTag({ name: 'Renovation' });
  data.accounts.push(bank);
  data.categories.push(food, travel, refunds);
  data.tags.push(trip, other);
  const e = (f) => makeEntry({ accountId: bank.id, date: '2026-10-10', status: 'done', ...f });
  const hotel = e({ title: 'Hotel', amount: 24000, categoryId: travel.id, tagIds: [trip.id] });
  const dinner = e({
    title: 'Dinner and tickets', amount: 9000, categoryId: food.id, tagIds: [trip.id],
    splits: [{ categoryId: food.id, amount: 6000 }, { categoryId: travel.id, amount: 3000 }]
  });
  const train = e({ title: 'Train back', amount: 4500, categoryId: travel.id, tagIds: [trip.id], status: 'planned' });
  const gone = e({ title: 'Museum', amount: 2000, categoryId: travel.id, tagIds: [trip.id], status: 'cancelled' });
  const refund = e({ title: 'Refund', type: 'income', amount: 1000, categoryId: refunds.id, tagIds: [trip.id] });
  const home = e({ title: 'Paint', amount: 3000, categoryId: food.id, tagIds: [other.id] });
  const untagged = e({ title: 'Coffee', amount: 300, categoryId: food.id });
  data.entries.push(hotel, dinner, train, gone, refund, home, untagged);
  return { data, bank, food, travel, trip, other, hotel, dinner, train, home, untagged };
}

describe('tags', () => {
  it('makeTag keeps the color in the palette and the budget in cents', () => {
    expect(makeTag({ color: 'neon' }).color).toBe(TAG_COLORS[0]);
    expect(makeTag({ budget: 0 }).budget).toBe(null);
    expect(makeTag({ budget: 1234.4 }).budget).toBe(1234);
    expect(makeTemplate({ tagIds: ['a', 'a', null] }).tagIds).toEqual(['a']);
  });

  it('adds and takes away a tag without duplicates', () => {
    expect(withTag(['a'], 'b')).toEqual(['a', 'b']);
    expect(withTag(['a'], 'a')).toEqual(['a']);
    expect(withTag(undefined, 'a')).toEqual(['a']);
    expect(withoutTag(['a', 'b'], 'a')).toEqual(['b']);
    expect(entryHasTag({ tagIds: ['a'] }, 'a')).toBe(true);
    expect(entryHasTag({}, 'a')).toBe(false);
  });

  it('knows where the dates stand', () => {
    const tag = { startDate: '2026-10-09', endDate: '2026-10-11' };
    expect(tagPhase(tag, '2026-10-01')).toBe('upcoming');
    expect(tagPhase(tag, '2026-10-10')).toBe('active');
    expect(tagPhase(tag, '2026-10-12')).toBe('ended');
    expect(tagPhase({}, '2026-10-12')).toBe('active');
  });

  it('sorts active tags first, then by name', () => {
    const { data, trip, other } = fixture();
    expect(sortedTags(data).map(x => x.id)).toEqual([other.id, trip.id]);
    other.archived = true;
    expect(sortedTags(data).map(x => x.id)).toEqual([trip.id]);
    expect(sortedTags(data, { includeArchived: true }).map(x => x.id)).toEqual([trip.id, other.id]);
  });
});

describe('tagSummary', () => {
  it('adds up spent, still planned and the budget', () => {
    const { data, trip } = fixture();
    const s = tagSummary(data, trip.id, '2026-10-10');
    expect(s.spent).toBe(33000);
    expect(s.planned).toBe(4500);
    expect(s.total).toBe(37500);
    expect(s.refunds).toBe(1000);
    expect(s.budget).toBe(60000);
    expect(s.left).toBe(27000);
    expect(s.percent).toBe(55);
    expect(s.count).toBe(3);
    expect(s.phase).toBe('active');
  });

  it('spreads split parts over their categories with the entry tag', () => {
    const { data, trip, food, travel } = fixture();
    expect(tagSummary(data, trip.id, '2026-10-10').byCategory).toEqual([
      { categoryId: travel.id, amount: 27000 }, { categoryId: food.id, amount: 6000 }
    ]);
  });

  it('has no budget figures without a budget', () => {
    const { data, other } = fixture();
    const s = tagSummary(data, other.id, '2026-10-10');
    expect(s.spent).toBe(3000);
    expect(s.budget).toBe(null);
    expect(s.percent).toBe(null);
  });
});

describe('tags in search and the store', () => {
  it('filters by tag and finds the tag name', () => {
    const { data, trip, hotel, dinner, train, home } = fixture();
    const ids = searchEntries(data, '', { tagId: trip.id }).results.map(e => e.id);
    expect(ids).toContain(hotel.id);
    expect(ids).toContain(dinner.id);
    expect(ids).toContain(train.id);
    expect(ids).not.toContain(home.id);
    expect(searchEntries(data, 'renovation').results.map(e => e.id)).toEqual([home.id]);
    expect(hasActiveFilters({ tagId: trip.id })).toBe(true);
  });

  it('deleting a tag removes it from entries and templates', () => {
    const { data, trip, hotel, home } = fixture();
    data.templates.push(makeTemplate({ title: 'Parking', tagIds: [trip.id], schedule: { freq: 'once', startDate: '2026-10-10' } }));
    const store = new Store(memoryAdapter(JSON.stringify(data)), { today: () => '2026-10-10' });
    expect(tagUsage(store.data, trip.id)).toEqual({ entries: 5, templates: 1 });
    store.removeTag(trip.id);
    expect(store.find('tags', trip.id)).toBe(null);
    expect(store.find('entries', hotel.id).tagIds).toEqual([]);
    expect(store.find('entries', home.id).tagIds.length).toBe(1);
    expect(tagUsage(store.data, trip.id)).toEqual({ entries: 0, templates: 0 });
  });

  it('templates pass their tags to generated and future entries', () => {
    const data = emptyData();
    const bank = makeAccount({ name: 'Main' });
    data.accounts.push(bank);
    const tpl = makeTemplate({ title: 'Gym', amount: 3000, accountId: bank.id, tagIds: ['t1'], schedule: { freq: 'monthly', day: 20, startDate: '2026-10-01' } });
    const store = new Store(memoryAdapter(JSON.stringify(data)), { today: () => '2026-10-10' });
    store.saveTemplate(tpl, { applyToFuture: false });
    const made = store.list('entries').filter(e => e.templateId === tpl.id);
    expect(made.length).toBeGreaterThan(0);
    expect(made.every(e => e.tagIds.includes('t1'))).toBe(true);
    store.saveTemplate({ ...store.find('templates', tpl.id), tagIds: ['t2'] }, { applyToFuture: true });
    const after = store.list('entries').filter(e => e.templateId === tpl.id);
    expect(after.every(e => e.tagIds.length === 1 && e.tagIds[0] === 't2')).toBe(true);
  });
});

describe('the demo trip', () => {
  it('has a tag with a budget, spending and a planned payment', async () => {
    const { buildDemo } = await import('../src/demo.js');
    ['en', 'ru'].forEach(lang => {
      const demo = buildDemo('2026-10-25', lang);
      expect(demo.tags.length).toBe(1);
      const s = tagSummary(demo, demo.tags[0].id, '2026-10-25');
      expect(s.spent).toBe(3890 + 21400 + 9650 + 1800);
      expect(s.planned).toBe(3890);
      expect(s.byCategory.length).toBe(3);
      expect(demo.entries.filter(e => e.splits).length).toBe(2);
    });
  });
});
