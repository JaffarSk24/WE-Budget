import { describe, it, expect } from 'vitest';
import { parseCsv } from '../src/import/csv.js';
import { fixMixedScript, importMonthlySheet, normalizeTitle, parseSheetDate } from '../src/import/sheet-import.js';
import { monthSummary } from '../src/ledger.js';
import { live } from '../src/model.js';

describe('csv', () => {
  it('handles quotes, commas and line breaks inside fields', () => {
    expect(parseCsv('a,"1,50€","say ""hi"""\r\nb,"two\nlines",\n')).toEqual([
      ['a', '1,50€', 'say "hi"'],
      ['b', 'two\nlines', '']
    ]);
  });
});

describe('cleanup helpers', () => {
  it('fixes Latin look-alikes inside Cyrillic words only', () => {
    expect(fixMixedScript('Аpендa')).toBe('Аренда');
    expect(fixMixedScript('Metro Card')).toBe('Metro Card');
  });

  it('clamps impossible days typed by hand', () => {
    expect(parseSheetDate('31.06.2024')).toBe('2024-06-30');
    expect(parseSheetDate('30.02.2026')).toBe('2026-02-28');
    expect(parseSheetDate('-')).toBe(null);
  });

  it('applies fixes and patterns', () => {
    const rules = { titlePatterns: [{ match: '^(Salary \\w+) (JANUARY|FEBRUARY)$', replace: '$1' }] };
    expect(normalizeTitle('Salary  Acme   FEBRUARY', rules)).toBe('Salary Acme');
  });
});

// A made-up household sheet: two history months and one planned month.
const SHEET = [
  'Status,Date,Item,Out,In,Account,Carry',
  '✅,01.08.2026,Carry over,"0,00€","100,00€",-,',
  '✅,02.08.2026,Salary,"0,00€","1 000,00€",-,',
  '✅,03.08.2026,Rent,"500,00€","0,00€",BANK (Bills),',
  '✅,10.08.2026,Phone,"20,00€","0,00€",BANK (Bills),',
  '✅,12.08.2026,Gym,"0,00€","0,00€",BANK (Bills),',
  ',-,Unexpected,"30,00€","0,00€",-,',
  ',Subtotal,,"550,00€","1 100,00€",Left,"550,00€"',
  '✅,01.09.2026,Carry over,"0,00€","550,00€",-,',
  '✅,02.09.2026,Salary,"0,00€","1 000,00€",-,',
  '✅,03.09.2026,Rent,"500,00€","0,00€",BANK (Bills),',
  ',-,Unexpected,"0,00€","0,00€",-,',
  ',Subtotal,,"500,00€","1 550,00€",Left,"1 000,00€"',
  ',01.10.2026,Carry over,"0,00€","1 000,00€",-,',
  '✅,02.10.2026,Salary,"0,00€","1 000,00€",-,',
  ',03.10.2026,Rent,"500,00€","0,00€",BANK (Bills),',
  ',05.10.2026,Streaming,"0,00€","0,00€",BANK (Bills),',
  ',-,Unexpected,"0,00€","0,00€",-,',
  ',Subtotal,,"500,00€","2 000,00€",Left,"1 500,00€"'
].join('\n');

const RULES = {
  language: 'en',
  trackingStart: '2026-10-01',
  subtotalMarkers: ['subtotal'],
  carryTitles: ['Carry over'],
  unexplainedTitles: ['Unexpected'],
  defaultAccount: 'Bank',
  accounts: { '-': null, 'BANK (Bills)': 'Bank / Bills' },
  categories: { Rent: 'Housing', Salary: 'Salary', Phone: 'Phone and subscriptions' },
  unexplainedCategory: 'No details'
};

describe('monthly sheet import', () => {
  const { data, report } = importMonthlySheet(SHEET, RULES);

  it('keeps the carried-over chain of the sheet', () => {
    expect(report.months.map(m => [m.month, m.closing, m.adjustment])).toEqual([
      ['2026-08', 55000, 0],
      ['2026-09', 100000, -5000],
      ['2026-10', 150000, 0]
    ]);
    // September rows add up to 1050 left, the sheet carried 1000: the gap
    // becomes one visible -50 adjustment.
    const adj = live(data.entries).filter(e => e.isAdjustment && e.title !== 'Opening balance');
    expect(adj).toHaveLength(1);
  });

  it('turns history into done entries and the planned month into templates', () => {
    const october = live(data.entries).filter(e => e.date.startsWith('2026-10'));
    expect(october.map(e => [e.title, e.status, e.amount]).sort()).toEqual([
      ['Rent', 'planned', 50000], ['Salary', 'done', 100000], ['Streaming', 'planned', 0]
    ]);
    // A zero row stays in the plan as a reminder and keeps generating.
    expect(data.templates.map(t => [t.title, t.active]).sort()).toEqual([
      ['Rent', true], ['Salary', true], ['Streaming', true]
    ]);
    expect(october.every(e => e.templateId)).toBe(true);
    // History has no use for zero rows.
    expect(live(data.entries).some(e => e.title === 'Gym')).toBe(false);
  });

  it('maps accounts to envelopes and opens tracking with the carried balance', () => {
    const names = data.accounts.map(a => a.name).sort();
    expect(names).toEqual(['Bank', 'Bills']);
    const bank = data.accounts.find(a => a.name === 'Bank');
    expect(bank.openingBalance).toBe(100000);
    expect(data.settings.trackingStart).toBe('2026-10-01');
    expect(monthSummary(data, '2026-10').opening).toBe(100000);
  });

  it('puts unexplained money into its own category', () => {
    const e = live(data.entries).find(x => x.title === 'Unexpected');
    expect(e.date).toBe('2026-08-12');
    expect(data.categories.find(c => c.id === e.categoryId).name).toBe('No details');
  });
});
