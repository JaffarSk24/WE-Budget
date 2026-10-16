import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ru } from '../src/i18n/ru.js';
import { en } from '../src/i18n/en.js';
import {
  FEATURES, HELP_GROUPS, HELP_ACTIONS, SETTINGS_SECTIONS, availability, bodyBlocks, filterFeatures, groupFeatures, helpKeys, matchesQuery
} from '../src/help.js';
import { usedIcons } from '../src/icons.js';

const trRu = (key) => ru[key] ?? key;
const trEn = (key) => en[key] ?? key;

// The view ids of main.js, read from its source: importing main.js would
// start the whole app.
function viewIds() {
  const src = readFileSync('src/main.js', 'utf8');
  const block = /const VIEWS = \{([\s\S]*?)\};/.exec(src)[1];
  return [...block.matchAll(/^\s*(\w+):/gm)].map(m => m[1]);
}

function navOrder() {
  const src = readFileSync('src/main.js', 'utf8');
  return [...(/const NAV_ORDER = \[([^\]]*)\]/.exec(src)[1]).matchAll(/'(\w+)'/g)].map(m => m[1]);
}

const pascal = (name) => name.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('');

describe('feature guide data', () => {
  it('ids are unique', () => {
    const ids = FEATURES.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every feature has a title, a short line and a description in both languages', () => {
    FEATURES.forEach(f => {
      Object.values(helpKeys(f.id)).forEach(key => {
        expect(typeof ru[key], key).toBe('string');
        expect(typeof en[key], key).toBe('string');
        expect(ru[key].trim().length, key).toBeGreaterThan(0);
        expect(en[key].trim().length, key).toBeGreaterThan(0);
      });
    });
  });

  it('every group has a heading in both languages and features keep the group order', () => {
    FEATURES.forEach(f => expect(HELP_GROUPS, f.id).toContain(f.group));
    HELP_GROUPS.forEach(g => {
      expect(ru[`help-group-${g}`]).toBeTruthy();
      expect(en[`help-group-${g}`]).toBeTruthy();
    });
    const order = FEATURES.map(f => HELP_GROUPS.indexOf(f.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('every target is a real screen, Settings section, dialog or phone tab', () => {
    const views = viewIds();
    FEATURES.forEach(f => {
      if (f.view !== 'phone') expect(views, f.id).toContain(f.view);
      if (f.section) {
        expect(f.view, f.id).toBe('settings');
        expect(Object.keys(SETTINGS_SECTIONS), f.id).toContain(f.section);
      }
      if (f.action) expect(Object.keys(HELP_ACTIONS), f.id).toContain(f.action);
      if (f.phoneAction) expect(Object.keys(HELP_ACTIONS), f.id).toContain(f.phoneAction);
      if (f.phone) expect(['today', 'accounts', 'more'], f.id).toContain(f.phone);
      if (f.view !== 'settings' && f.view !== 'phone') expect(ru[`nav-${f.view}`], f.id).toBeTruthy();
    });
  });

  it('every icon is bundled', () => {
    FEATURES.forEach(f => expect(usedIcons[pascal(f.icon)], f.icon).toBeTruthy());
    ['book-open', 'lightbulb'].forEach(name => expect(usedIcons[pascal(name)], name).toBeTruthy());
  });

  it('every Settings section named here is marked in Settings', () => {
    const src = readFileSync('src/views/settings.js', 'utf8');
    Object.keys(SETTINGS_SECTIONS).forEach(id => expect(src, id).toContain(`'${id}')`));
  });

  it('Features is a screen of its own, reachable by Cmd/Ctrl + number', () => {
    const order = navOrder();
    expect(order).toContain('help');
    expect(order.indexOf('help')).toBe(order.indexOf('settings') - 1);
    expect(order.length).toBeLessThanOrEqual(9);
    const html = readFileSync('index.html', 'utf8');
    order.forEach(view => {
      expect(html, view).toContain(`data-view="${view}"`);
      expect(html, view).toContain(`id="view-${view}"`);
    });
  });

  it('tells where a feature can be used', () => {
    expect(availability({ view: 'accounts' })).toBe('desktop');
    expect(availability({ view: 'month', phone: 'today' })).toBe('both');
    expect(availability({ view: 'phone', phone: 'today' })).toBe('phone');
    expect(availability(FEATURES.find(f => f.id === 'bank-import'))).toBe('desktop');
    expect(availability(FEATURES.find(f => f.id === 'menu-bar'))).toBe('desktop');
  });
});

describe('feature guide search', () => {
  const sample = [
    { id: 'a', group: 'start', isNew: true },
    { id: 'b', group: 'plan' },
    { id: 'c', group: 'start' }
  ];
  const dict = {
    'help-a-title': 'Káva a čaj', 'help-a-short': 'Drinks', 'help-a-body': 'Morning ritual',
    'help-b-title': 'Конверты', 'help-b-short': 'Подсчёты внутри счёта', 'help-b-body': 'Ёлка и ЙОГУРТ',
    'help-c-title': 'Statement', 'help-c-short': 'CSV', 'help-c-body': 'Import from the BANK'
  };
  const tr = (key) => dict[key] ?? key;

  it('matches the title, the short line and the description', () => {
    expect(filterFeatures(sample, { query: 'kava' }, tr).map(f => f.id)).toEqual(['a']);
    expect(filterFeatures(sample, { query: 'csv' }, tr).map(f => f.id)).toEqual(['c']);
    expect(filterFeatures(sample, { query: 'bank' }, tr).map(f => f.id)).toEqual(['c']);
  });

  it('ignores case and diacritics', () => {
    expect(matchesQuery(sample[0], 'KÁVA', tr)).toBe(true);
    expect(matchesQuery(sample[0], 'CAJ', tr)).toBe(true);
    expect(matchesQuery(sample[1], 'елка', tr)).toBe(true);
    expect(matchesQuery(sample[1], 'йогурт', tr)).toBe(true);
    expect(matchesQuery(sample[1], 'подсчеты', tr)).toBe(true);
  });

  it('needs every word of the query', () => {
    expect(matchesQuery(sample[2], 'import bank', tr)).toBe(true);
    expect(matchesQuery(sample[2], 'import coffee', tr)).toBe(false);
  });

  it('an empty query finds everything', () => {
    expect(filterFeatures(sample, { query: '  ' }, tr)).toHaveLength(3);
  });

  it('works on the real texts in both languages', () => {
    expect(filterFeatures(FEATURES, { query: 'выписк' }, trRu).map(f => f.id)).toContain('bank-import');
    expect(filterFeatures(FEATURES, { query: 'statement' }, trEn).map(f => f.id)).toContain('bank-import');
    expect(filterFeatures(FEATURES, { query: 'DIAGRAM' }, trEn).map(f => f.id)).toContain('money-flow');
    expect(filterFeatures(FEATURES, { query: 'конверт' }, trRu).map(f => f.id)).toContain('envelopes');
  });

  it('"What is new" keeps only the features marked new', () => {
    expect(filterFeatures(sample, { onlyNew: true }, tr).map(f => f.id)).toEqual(['a']);
    expect(filterFeatures(sample, { onlyNew: true, query: 'statement' }, tr)).toEqual([]);
    const fresh = filterFeatures(FEATURES, { onlyNew: true }, trRu).map(f => f.id);
    ['quick-links', 'runway', 'alerts', 'save-ahead', 'recurring-overview', 'search', 'bank-import', 'category-rules',
      'debts', 'limits', 'split-payments', 'tags', 'what-if', 'month-calendar', 'net-worth', 'money-flow', 'encryption', 'journal']
      .forEach(id => expect(fresh, id).toContain(id));
    expect(fresh).toHaveLength(18);
  });

  it('groups found features in the order of the groups', () => {
    expect(groupFeatures(sample).map(g => [g.group, g.features.map(f => f.id)])).toEqual([['start', ['a', 'c']], ['plan', ['b']]]);
  });
});

describe('feature descriptions', () => {
  it('split into paragraphs and lists', () => {
    expect(bodyBlocks('One.\nStill one.\n\n- a\n- b\n\n1. x\n2. y')).toEqual([
      { type: 'p', text: 'One. Still one.' },
      { type: 'ul', items: ['a', 'b'] },
      { type: 'ol', items: ['x', 'y'] }
    ]);
  });

  it('have two to five blocks in both languages', () => {
    FEATURES.forEach(f => [ru, en].forEach(dict => {
      const n = bodyBlocks(dict[helpKeys(f.id).body]).length;
      expect(n, f.id).toBeGreaterThanOrEqual(2);
      expect(n, f.id).toBeLessThanOrEqual(5);
    }));
  });
});
