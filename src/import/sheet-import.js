// Import of a spreadsheet budget kept as monthly blocks:
//
//   status | date | title | expense | income | account | carry
//   ...one row per payment...
//   (optional) catch-all row for unexplained money
//   subtotal row: totals of the month and the amount carried over
//
// Everything specific to one spreadsheet (which account string means which
// account, how titles should be cleaned up, categories, transit pairs) comes
// from a rules object, so the code itself holds no personal data.
//
// Months before rules.trackingStart become history (done entries that feed
// analytics and month views). From trackingStart on, rows become planned or
// done entries tied to recurring templates that continue the plan.

import { parseCsv } from './csv.js';
import { parseMoney } from '../money.js';
import {
  defaultCategories, emptyData, makeAccount, makeCategory, makeEntry, makeTemplate, nowIso
} from '../model.js';
import { daysInMonth, lastDayOfMonth, monthOf } from '../dates.js';

const DEFAULT_COLUMNS = { status: 0, date: 1, title: 2, expense: 3, income: 4, account: 5, carry: 6 };

// Latin letters that look Cyrillic. A word written mostly in Cyrillic with
// one of these inside it was typed with the wrong keyboard layout.
const HOMOGLYPHS = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х' };

export function fixMixedScript(text) {
  return text.replace(/[\p{L}]+/gu, word => {
    const cyr = (word.match(/[Ѐ-ӿ]/g) || []).length;
    const lat = (word.match(/[A-Za-z]/g) || []).length;
    if (!cyr || !lat || lat > cyr) return word;
    if ([...word].some(ch => /[A-Za-z]/.test(ch) && !HOMOGLYPHS[ch])) return word;
    return [...word].map(ch => HOMOGLYPHS[ch] || ch).join('');
  });
}

export function parseSheetDate(value) {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(value || '');
  if (!m) return null;
  const year = Number(m[3]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  // Sheets typed by hand contain days like 31.06 or 30.02: clamp them.
  const day = Math.min(Math.max(1, Number(m[1])), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeTitle(raw, rules = {}) {
  let title = fixMixedScript(String(raw || '').replace(/\s+/g, ' ').trim());
  if (rules.titleFixes && rules.titleFixes[title]) title = rules.titleFixes[title];
  (rules.titlePatterns || []).forEach(p => {
    title = title.replace(new RegExp(p.match, 'u'), p.replace);
  });
  return title.replace(/\s+/g, ' ').trim();
}

function cell(row, idx) {
  return idx === undefined || idx === null ? '' : String(row[idx] ?? '').trim();
}

function amount(row, idx) {
  const v = parseMoney(cell(row, idx));
  return v === null ? 0 : v;
}

function mode(values) {
  const counts = new Map();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  let best = null;
  counts.forEach((n, v) => { if (best === null || n > counts.get(best)) best = v; });
  return best;
}

export function importMonthlySheet(csvText, rules = {}) {
  const cols = { ...DEFAULT_COLUMNS, ...(rules.columns || {}) };
  const lang = rules.language || 'ru';
  const lower = (list) => (list || []).map(s => s.toLowerCase());
  const subtotalMarkers = lower(rules.subtotalMarkers || ['subtotal']);
  const carryTitles = lower(rules.carryTitles || ['carry over']);
  const unexplainedTitles = lower(rules.unexplainedTitles || []);
  const transitTitles = new Set(rules.transitTitles || []);
  const doneMarker = rules.doneMarker || '✅';
  const trackingStart = rules.trackingStart || null;
  const forwardFrom = trackingStart ? monthOf(trackingStart) : '9999-12';
  const overrides = rules.monthOverrides || {};

  const data = emptyData();
  const report = {
    months: [], unmappedAccounts: new Map(), uncategorized: new Map(),
    skipped: [], opening: null, templates: 0
  };

  // ---------- accounts ----------
  const accountByPath = new Map();
  function ensureAccount(path) {
    if (accountByPath.has(path)) return accountByPath.get(path);
    const [parentName, childName] = path.split('/').map(s => s.trim());
    let parent = accountByPath.get(parentName);
    if (!parent) {
      const meta = (rules.accountMeta || {})[parentName] || {};
      parent = makeAccount({ name: parentName, bank: meta.bank || parentName, kind: meta.kind, order: accountByPath.size });
      data.accounts.push(parent);
      accountByPath.set(parentName, parent);
    }
    if (!childName) return parent;
    const child = makeAccount({ name: childName, parentId: parent.id, bank: parent.bank, order: accountByPath.size });
    data.accounts.push(child);
    accountByPath.set(path, child);
    return child;
  }
  const defaultAccountPath = rules.defaultAccount || 'Main';
  function resolveAccount(raw) {
    const key = (raw || '').trim();
    const mapping = rules.accounts || {};
    if (!key || key === '-' || mapping[key] === null) return ensureAccount(defaultAccountPath);
    if (mapping[key]) return ensureAccount(mapping[key]);
    report.unmappedAccounts.set(key, (report.unmappedAccounts.get(key) || 0) + 1);
    return ensureAccount(key);
  }

  // ---------- categories ----------
  data.categories.push(...defaultCategories(lang));
  function ensureCategory(name, type) {
    if (!name) return null;
    let cat = data.categories.find(c => c.name === name && c.type === type);
    if (!cat) {
      cat = makeCategory({ name, type });
      data.categories.push(cat);
    }
    return cat.id;
  }
  function categoryFor(title, type) {
    const name = (rules.categories || {})[title];
    if (!name) {
      const key = `${type}: ${title}`;
      report.uncategorized.set(key, (report.uncategorized.get(key) || 0) + 1);
      return null;
    }
    return ensureCategory(name, type);
  }

  // ---------- split rows into monthly blocks ----------
  const rows = parseCsv(csvText).slice(rules.headerRows ?? 1);

  // A row with zero in both columns does not say whether it is an expense or
  // an income; the same title with an amount elsewhere in the sheet does.
  const knownType = new Map();
  rows.forEach(row => {
    const title = normalizeTitle(cell(row, cols.title), rules);
    if (!title || knownType.has(title)) return;
    if (amount(row, cols.income)) knownType.set(title, 'income');
    else if (amount(row, cols.expense)) knownType.set(title, 'expense');
  });
  const blocks = [];
  let current = [];
  rows.forEach((row, i) => {
    const line = i + 1 + (rules.headerRows ?? 1);
    if (row.every(c => !String(c).trim())) return;
    const head = [cell(row, 0), cell(row, 1), cell(row, 2)].join(' ').toLowerCase();
    if (subtotalMarkers.some(m => head.includes(m))) {
      blocks.push({
        rows: current,
        subtotal: { line, expense: amount(row, cols.expense), income: amount(row, cols.income), carry: amount(row, cols.carry) }
      });
      current = [];
      return;
    }
    current.push({ line, row });
  });
  if (current.length) blocks.push({ rows: current, subtotal: null });

  // ---------- build entries ----------
  const templateGroups = new Map();
  let pool = 0;
  let firstCarrySeen = false;
  let lastForwardMonth = null;

  blocks.forEach(block => {
    const months = block.rows.map(r => parseSheetDate(cell(r.row, cols.date))).filter(Boolean).map(monthOf);
    const month = mode(months);
    if (!month) {
      block.rows.forEach(r => report.skipped.push({ line: r.line, reason: 'block without dates' }));
      return;
    }
    const forward = month >= forwardFrom;
    if (forward) lastForwardMonth = month;
    const monthRules = overrides[month] || {};
    let lastDate = null;
    const created = [];
    const perTitleCount = new Map();

    block.rows.forEach(({ line, row }) => {
      const rawTitle = cell(row, cols.title);
      const titleKey = rawTitle.replace(/\s+/g, ' ').trim().toLowerCase();
      const date = parseSheetDate(cell(row, cols.date));
      if (date) lastDate = date;

      if (carryTitles.includes(titleKey)) {
        const carry = amount(row, cols.income) - amount(row, cols.expense);
        if (!firstCarrySeen) {
          firstCarrySeen = true;
          if (!forward && carry !== 0) {
            const e = makeEntry({
              date: date || `${month}-01`, title: rules.openingTitle || 'Opening balance',
              type: carry > 0 ? 'income' : 'expense', amount: Math.abs(carry),
              accountId: ensureAccount(defaultAccountPath).id, status: 'done', isAdjustment: true
            });
            data.entries.push(e);
            created.push(e);
          }
        }
        if (forward && !report.opening) report.opening = { month, amount: carry };
        return;
      }

      const exp = amount(row, cols.expense);
      const inc = amount(row, cols.income);

      if (unexplainedTitles.includes(titleKey)) {
        if (monthRules.ignoreUnexplained || (!exp && !inc)) return;
        const day = lastDate || lastDayOfMonth(month);
        [['expense', exp], ['income', inc]].forEach(([type, value]) => {
          if (!value) return;
          const e = makeEntry({
            date: day, title: rules.unexplainedTitle || rawTitle, type, amount: value,
            accountId: ensureAccount(defaultAccountPath).id,
            categoryId: ensureCategory(type === 'expense' ? rules.unexplainedCategory : rules.unexplainedIncomeCategory, type),
            status: forward ? 'planned' : 'done'
          });
          data.entries.push(e);
          created.push(e);
        });
        return;
      }

      if (!date) {
        report.skipped.push({ line, reason: 'no date', title: rawTitle });
        return;
      }
      const title = normalizeTitle(rawTitle, rules);
      const account = resolveAccount(cell(row, cols.account));
      const isDone = cell(row, cols.status).includes(doneMarker);
      const status = forward ? (isDone ? 'done' : 'planned') : 'done';

      // Zero rows are kept in the planned months: they are reminders that
      // the payment exists and may come back. History has no use for them.
      const parts = [['expense', exp], ['income', inc]].filter(([, v]) => v);
      if (!parts.length) {
        if (!forward) return;
        parts.push([knownType.get(title) || rules.zeroRowType || 'expense', 0]);
      }

      parts.forEach(([type, value]) => {
        const countKey = `${type}|${title}`;
        const index = (perTitleCount.get(countKey) || 0) + 1;
        perTitleCount.set(countKey, index);

        let entry = null;
        if (value || forward) {
          entry = makeEntry({
            date, title, type, amount: value, accountId: account.id,
            categoryId: categoryFor(title, type), status,
            isTransit: transitTitles.has(title),
            doneAt: status === 'done' ? nowIso() : null
          });
          data.entries.push(entry);
          created.push(entry);
        }
        if (forward) {
          const key = `${type}|${title}|${index}`;
          const group = templateGroups.get(key) || { type, title, rows: [] };
          group.rows.push({ date, amount: value, accountId: account.id, entry });
          templateGroups.set(key, group);
        }
      });
    });

    // History months: keep the pooled chain equal to what the sheet carried
    // over. A gap means the sheet was corrected by hand; it becomes a visible
    // adjustment instead of silently disappearing.
    const flow = (type) => created.filter(e => e.type === type && !e.isAdjustment)
      .reduce((s, e) => s + e.amount, 0);
    const effect = created.reduce((s, e) => s + (e.type === 'income' ? e.amount : e.type === 'expense' ? -e.amount : 0), 0);
    pool += effect;
    const info = {
      month,
      forward,
      sheetExpense: block.subtotal ? block.subtotal.expense : null,
      sheetIncome: block.subtotal ? block.subtotal.income : null,
      sheetCarry: block.subtotal ? block.subtotal.carry : null,
      importedExpense: flow('expense'),
      importedIncome: flow('income'),
      closing: pool,
      adjustment: 0
    };
    if (!forward && block.subtotal) {
      const diff = block.subtotal.carry - pool;
      if (diff !== 0) {
        data.entries.push(makeEntry({
          date: lastDayOfMonth(month), title: rules.adjustmentTitle || 'Difference with the spreadsheet',
          type: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff),
          accountId: ensureAccount(defaultAccountPath).id, status: 'done', isAdjustment: true
        }));
        pool += diff;
        info.adjustment = diff;
        info.closing = pool;
      }
    }
    report.months.push(info);
  });

  // ---------- templates from the planned months ----------
  const horizon = lastForwardMonth ? lastDayOfMonth(lastForwardMonth) : null;
  templateGroups.forEach(group => {
    const o = (rules.templateOverrides || {})[group.title] || {};
    const nonZero = group.rows.filter(r => r.amount);
    const last = nonZero[nonZero.length - 1] || group.rows[group.rows.length - 1];
    const first = group.rows[0];
    const template = makeTemplate({
      title: group.title,
      type: group.type,
      amount: o.amount ?? last.amount,
      amountIsEstimate: !!o.amountIsEstimate,
      accountId: last.accountId,
      categoryId: data.entries.find(e => e.title === group.title && e.categoryId)?.categoryId || null,
      isTransit: transitTitles.has(group.title),
      active: o.active ?? true,
      schedule: {
        freq: o.freq || 'monthly',
        interval: o.interval || 1,
        fillGaps: Boolean(o.fillGaps),
        // The latest month says best where the payment has settled.
        day: o.day || Number(group.rows[group.rows.length - 1].date.slice(8, 10)),
        startDate: o.startDate || first.date
      },
      generatedThrough: horizon
    });
    data.templates.push(template);
    group.rows.forEach(r => {
      // The sheet's own figure for that month is what was planned then.
      if (r.entry) Object.assign(r.entry, { templateId: template.id, occurrence: r.date, plannedAmount: r.amount });
    });
    report.templates++;
  });

  // ---------- opening balance and settings ----------
  const defaultAccount = ensureAccount(defaultAccountPath);
  if (report.opening) defaultAccount.openingBalance = report.opening.amount;
  data.settings = {
    ...data.settings,
    language: lang,
    trackingStart,
    defaultIncomeAccountId: defaultAccount.id,
    onboarded: true,
    updatedAt: nowIso()
  };

  return {
    data,
    report: {
      ...report,
      unmappedAccounts: [...report.unmappedAccounts.entries()],
      uncategorized: [...report.uncategorized.entries()].sort((a, b) => b[1] - a[1])
    }
  };
}
