import { describe, it, expect } from 'vitest';
import { applyRules, normalizeText, suggestRuleText, cleanTitle, ruleMatches } from '../src/rules.js';
import { makeRule, normalizeData, emptyData, COLLECTIONS } from '../src/model.js';

describe('category rules', () => {
  const groceries = makeRule({ text: 'lidl', field: 'title', categoryId: 'cat-food', order: 2 });
  const fuel = makeRule({ text: 'SHELL', match: 'startsWith', type: 'expense', categoryId: 'cat-car', order: 1 });
  const salary = makeRule({ text: 'Example Ltd payroll', match: 'exact', type: 'income', categoryId: 'cat-salary', order: 3 });

  it('normalizes case, diacritics and spaces', () => {
    expect(normalizeText('  Potraviny   ŽILINA ')).toBe('potraviny zilina');
    expect(ruleMatches(makeRule({ text: 'potraviny zilina' }), { text: 'POTRAVINY  Žilina 12' })).toBe(true);
  });

  it('finds the first active rule in order', () => {
    expect(applyRules([groceries, fuel, salary], { text: 'LIDL DEKUJE ZA NAKUP 1234', type: 'expense', amount: 2350 })).toBe(groceries);
    expect(applyRules([groceries, fuel], { text: 'Shell Lidl station', type: 'expense' })).toBe(fuel);
    expect(applyRules([groceries, fuel], { text: 'Station Shell', type: 'expense' })).toBe(null);
    expect(applyRules([salary], { text: 'example ltd  PAYROLL', type: 'income' })).toBe(salary);
    expect(applyRules([salary], { text: 'Example Ltd payroll March', type: 'income' })).toBe(null);
  });

  it('respects field, type, amount limits, active and deleted', () => {
    const noteOnly = makeRule({ text: 'gym', field: 'note', categoryId: 'x' });
    expect(applyRules([noteOnly], { text: 'Gym', note: '' })).toBe(null);
    expect(applyRules([noteOnly], { text: '', note: 'monthly gym' })).toBe(noteOnly);
    expect(applyRules([fuel], { text: 'Shell', type: 'income' })).toBe(null);
    const small = makeRule({ text: 'coffee', minAmount: 100, maxAmount: 1000 });
    expect(applyRules([small], { text: 'coffee', amount: 350 })).toBe(small);
    expect(applyRules([small], { text: 'coffee', amount: -350 })).toBe(small);
    expect(applyRules([small], { text: 'coffee', amount: 5000 })).toBe(null);
    expect(applyRules([small], { text: 'coffee', amount: null })).toBe(small);
    expect(applyRules([{ ...groceries, active: false }], { text: 'lidl' })).toBe(null);
    expect(applyRules([{ ...groceries, deleted: true }], { text: 'lidl' })).toBe(null);
    expect(applyRules([makeRule({ text: '  ' })], { text: 'anything' })).toBe(null);
  });

  it('suggests a short stable piece of a bank description', () => {
    expect(suggestRuleText('LIDL DEKUJE ZA NAKUP 1234')).toBe('LIDL');
    expect(suggestRuleText('Card payment 4532 **** 1234 Coffee Corner 12.03.2026')).toBe('Coffee Corner');
    expect(suggestRuleText('PLATBA KARTOU 12.03.2026 14:32 Potraviny Žilina 12,50 EUR')).toBe('Potraviny Žilina');
    expect(suggestRuleText('To Jan Example')).toBe('Jan Example');
    expect(suggestRuleText('Pizza to go')).toBe('Pizza to go');
    expect(suggestRuleText('REF 99887766 Example Gym Monthly Fee')).toBe('Example Gym Monthly');
    expect(suggestRuleText('')).toBe('');
    // Whatever is suggested must match the text it came from.
    ['LIDL DEKUJE ZA NAKUP 1234', 'Netflix.com 4,99', '"Shell", Bratislava 2'].forEach(text => {
      expect(ruleMatches(makeRule({ text: suggestRuleText(text) }), { text })).toBe(true);
    });
  });

  it('makes a clean title out of shouting', () => {
    expect(cleanTitle('LIDL')).toBe('Lidl');
    expect(cleanTitle('COFFEE CORNER')).toBe('Coffee Corner');
    expect(cleanTitle('Netflix.com')).toBe('Netflix.com');
  });
});

describe('rules collection', () => {
  it('is a synced collection and old documents still load', () => {
    expect(COLLECTIONS).toContain('rules');
    const old = emptyData();
    delete old.rules;
    delete old.settings.importMappings;
    const data = normalizeData(JSON.parse(JSON.stringify(old)));
    expect(data.rules).toEqual([]);
    expect(data.settings.importMappings).toEqual({});
  });

  it('makeRule cleans its fields', () => {
    const r = makeRule({ text: 'x', field: 'bad', match: 'bad', type: 'bad', minAmount: -500, maxAmount: '' });
    expect(r).toMatchObject({ field: 'any', match: 'contains', type: 'any', minAmount: 500, maxAmount: null, active: true, deleted: false });
  });
});
