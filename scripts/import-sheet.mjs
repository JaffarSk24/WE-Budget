// Converts a monthly-block spreadsheet export (CSV) into a WE Budget data
// file, using a rules file that describes that particular spreadsheet.
//
//   node scripts/import-sheet.mjs --csv export.csv --rules rules.json --out budget.json
//
// Prints a month-by-month comparison with the spreadsheet's own totals.
import { readFileSync, writeFileSync } from 'node:fs';
import { importMonthlySheet } from '../src/import/sheet-import.js';
import { formatMoney } from '../src/money.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

const csvPath = arg('csv');
const rulesPath = arg('rules');
const outPath = arg('out');
if (!csvPath || !rulesPath || !outPath) {
  console.error('Usage: node scripts/import-sheet.mjs --csv <file> --rules <file> --out <file>');
  process.exit(1);
}

const rules = JSON.parse(readFileSync(rulesPath, 'utf8'));
const { data, report } = importMonthlySheet(readFileSync(csvPath, 'utf8'), rules);
writeFileSync(outPath, JSON.stringify(data, null, 1), 'utf8');

const m = (c) => (c === null || c === undefined ? '-' : formatMoney(c, { lang: 'en' }));
console.log('month    | sheet expense | imported | sheet income | imported | sheet carry | closing | adjustment');
report.months.forEach(r => {
  console.log([r.month + (r.forward ? '*' : ' '), m(r.sheetExpense), m(r.importedExpense), m(r.sheetIncome),
    m(r.importedIncome), m(r.sheetCarry), m(r.closing), r.adjustment ? m(r.adjustment) : ''].join(' | '));
});
console.log(`\nentries: ${data.entries.length}, accounts: ${data.accounts.length}, templates: ${report.templates}`);
console.log('opening balance at tracking start:', report.opening ? m(report.opening.amount) : '-');
if (report.unmappedAccounts.length) console.log('unmapped accounts:', report.unmappedAccounts);
if (report.uncategorized.length) console.log('uncategorized:', report.uncategorized);
if (report.skipped.length) console.log('skipped rows:', report.skipped);
