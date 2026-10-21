import { describe, it, expect, beforeAll } from 'vitest';
import { buildDemo } from '../src/demo.js';
import { defaultCategories, normalizeData } from '../src/model.js';
import { ensureLanguage, translations } from '../src/i18n.js';
import { LANGUAGES } from '../src/i18n/languages.js';

const live = (list) => list.filter(x => !x.deleted);

describe('a new budget and the demo in the interface language', () => {
  beforeAll(async () => {
    for (const l of LANGUAGES) await ensureLanguage(l.code);
  });

  it('names the default categories in every language', () => {
    LANGUAGES.forEach(l => {
      const names = defaultCategories(l.code).map(c => c.name);
      expect(names.length, l.code).toBe(22);
      expect(names, l.code).toContain(translations[l.code]['defcat-groceries']);
      expect(names.filter(n => n.startsWith('defcat-')), l.code).toEqual([]);
      // Expense and income categories are told apart by name in pickers.
      expect(new Set(names).size, l.code).toBe(names.length);
    });
  });

  it('keeps the Russian and English default categories as before', () => {
    expect(defaultCategories('ru').map(c => c.name).slice(0, 3)).toEqual(['Жильё', 'Продукты', 'Транспорт']);
    expect(defaultCategories('en').map(c => c.name).slice(-2)).toEqual(['Refunds', 'Other income']);
  });

  it('builds the demo household in every language', () => {
    LANGUAGES.forEach(l => {
      const demo = buildDemo('2026-10-25', l.code);
      const dict = translations[l.code];
      expect(demo.settings.language, l.code).toBe(l.code);
      expect(demo.accounts.map(a => a.name), l.code).toContain(dict['demo-account-main']);
      expect(demo.tags[0].name, l.code).toBe(dict['demo-trip']);
      const texts = [
        ...demo.accounts.map(a => a.name), ...demo.templates.map(x => x.title), ...demo.entries.map(e => e.title),
        ...demo.goals.map(g => g.name), ...demo.debts.map(d => d.name), ...demo.rules.map(r => r.title || r.text),
        ...demo.assets.map(a => a.name), ...demo.scenarios.map(s => s.title)
      ];
      expect(texts.filter(s => /^(demo|defcat)-/.test(s) || /\{\w+\}/.test(s)), l.code).toEqual([]);
      // Every categorised record points to a category of the demo.
      const ids = new Set(demo.categories.map(c => c.id));
      [...demo.templates, ...demo.entries].filter(x => x.type !== 'transfer').forEach(x => {
        expect(ids.has(x.categoryId), `${l.code} ${x.title}`).toBe(true);
      });
      expect(demo.categories.filter(c => c.monthlyLimit).length, l.code).toBe(2);
    });
  });

  it('leaves the names of an existing budget as they are', () => {
    const saved = { settings: { language: 'de' }, categories: [{ id: 'c1', name: 'Groceries', type: 'expense' }], accounts: [{ id: 'a1', name: 'Main' }] };
    const data = normalizeData(saved);
    expect(live(data.categories).map(c => c.name)).toEqual(['Groceries']);
    expect(live(data.accounts).map(a => a.name)).toEqual(['Main']);
  });
});
