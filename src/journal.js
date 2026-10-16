// Change journal: what changed in the budget on this device and how to take
// a change back. Pure functions only; storage lives in journal-log.js.
//
// A journal item is one record changed by one step:
//   { id, batchId, at, source, collection, recordId, op, before, after, fields, label }
// `before` and `after` are full copies of the record (null for a record that
// did not exist), so any step can be undone without the rest of the journal.
// Everything that changed in one step (one click, one bulk action, one sync)
// shares a batchId and is shown as one line.

import { COLLECTIONS, newId, nowIso } from './model.js';
import { canonical } from './sync/hash.js';
import { t, tn, translations, currentLang } from './i18n.js';
import { formatMoney } from './money.js';
import { formatDate, isDayKey, dayKey } from './dates.js';
import { store } from './store.js';

// 'auto': the plan generated from recurring payments, nobody clicked.
export const JOURNAL_SOURCES = ['local', 'sync', 'restore', 'import', 'auto'];
export const KEEP_DAYS = 90;
export const MAX_ITEMS = 5000;

// Bookkeeping that is not an edit: updatedAt moves with every write, and
// generatedThrough only records how far the plan is generated. Neither
// makes a change of its own, and a revert keeps their current values (an
// older generatedThrough would generate the same payments twice).
const BOOKKEEPING = ['updatedAt', 'generatedThrough'];

// Fields that change along with a status and say nothing a person would
// call an edit; they stay in the copies but are left out of descriptions.
const QUIET_FIELDS = new Set(['createdAt', 'doneAt', 'reservedAt', 'allocationId', 'movedFrom', 'plannedAmount', 'rolloverFrom']);

// The screen's filter groups. Collections not named here (and any added
// later) fall into 'other'.
export const COLLECTION_GROUPS = {
  payments: ['entries'],
  recurring: ['templates'],
  accounts: ['accounts'],
  categories: ['categories'],
  goals: ['goals']
};

export function collectionGroup(collection) {
  const found = Object.keys(COLLECTION_GROUPS).find(g => COLLECTION_GROUPS[g].includes(collection));
  return found || 'other';
}

function contentKey(rec) {
  if (!rec) return null;
  const copy = { ...rec };
  BOOKKEEPING.forEach(f => { delete copy[f]; });
  return canonical(copy);
}

// Same record content, bookkeeping aside.
export function sameContent(a, b) {
  return contentKey(a) === contentKey(b);
}

export function changedFields(before, after) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(k => !BOOKKEEPING.includes(k) && k !== 'deleted'
    && canonical(before[k]) !== canonical(after[k]));
}

function opFor(before, after) {
  if (!before) return after.deleted ? null : 'add';
  if (before.deleted && after.deleted) return null;
  if (before.deleted) return 'undelete';
  if (after.deleted) return 'delete';
  return 'edit';
}

// One record's change, or null when nothing a person would see changed.
export function recordChange(collection, before, after) {
  const op = opFor(before, after);
  if (!op) return null;
  if (op === 'edit' && sameContent(before, after)) return null;
  return { collection, recordId: after.id, op, before, after, fields: changedFields(before, after) };
}

function clone(rec) {
  return typeof structuredClone === 'function' ? structuredClone(rec) : JSON.parse(JSON.stringify(rec));
}

// Keeps a copy of every record as of the last look, so a step's changes are
// found without copying the whole budget on every click: a record whose
// updatedAt did not move is skipped at once, and only changed records are
// compared and copied.
export class JournalTracker {
  constructor(collections = COLLECTIONS) {
    this.collections = collections;
    this.shadow = new Map();
  }

  reset(data) {
    this.shadow = new Map();
    this.collections.forEach(name => {
      this.shadow.set(name, new Map((data[name] || []).map(r => [r.id, clone(r)])));
    });
  }

  diff(data) {
    const changes = [];
    this.collections.forEach(name => {
      let known = this.shadow.get(name);
      if (!known) {
        known = new Map();
        this.shadow.set(name, known);
      }
      const list = data[name] || [];
      list.forEach(rec => {
        const old = known.get(rec.id);
        if (old && old.updatedAt === rec.updatedAt) return;
        const change = recordChange(name, old || null, rec);
        known.set(rec.id, clone(rec));
        if (change) changes.push({ ...change, after: known.get(rec.id) });
      });
      // A record that left the document altogether counts as deleted.
      if (known.size > list.length) {
        const ids = new Set(list.map(r => r.id));
        [...known.keys()].forEach(id => {
          if (ids.has(id)) return;
          const old = known.get(id);
          known.delete(id);
          if (!old.deleted) changes.push({ collection: name, recordId: id, op: 'delete', before: old, after: { ...old, deleted: true }, fields: [] });
        });
      }
    });
    return changes;
  }
}

// Only the records that changed between two copies of the budget.
export function diffData(before, after, collections = COLLECTIONS) {
  const tracker = new JournalTracker(collections);
  tracker.reset(before || {});
  return tracker.diff(after || {});
}

export function recordLabel(rec) {
  if (!rec) return '';
  return String(rec.title || rec.name || rec.text || rec.note || '').trim();
}

export function makeItems(changes, { batchId = newId(), at = nowIso(), source = 'local' } = {}) {
  return changes.map(c => ({
    id: newId(),
    batchId,
    at,
    source,
    collection: c.collection,
    recordId: c.recordId,
    op: c.op,
    before: c.before,
    after: c.after,
    fields: c.fields,
    label: recordLabel(c.after && !c.after.deleted ? c.after : c.before || c.after)
  }));
}

// ---------- taking changes back ----------

// The record as it should be after taking `target` back: its content, the
// current bookkeeping, a fresh updatedAt so sync carries it to the other
// devices as the newest change.
function asNewChange(target, current, now) {
  const rec = clone(target);
  BOOKKEEPING.forEach(f => {
    if (current && current[f] !== undefined) rec[f] = current[f];
  });
  rec.updatedAt = now;
  return rec;
}

function findRecord(data, collection, id) {
  return (data[collection] || []).find(r => r.id === id) || null;
}

// Patches that bring the batch's records back to their state before it, as
// a new change: added records become tombstones, edited and deleted ones
// get their old content with a fresh updatedAt. A record that changed again
// after the batch is a conflict: it is left out unless `force` is set, so
// the person can see it and choose. Records already back where they were
// need nothing.
// Returns { patches: [{ collection, id, record }], conflicts: [{ item, current, target }], unchanged }.
export function revertBatch(data, items, { now = nowIso(), force = false } = {}) {
  const patches = [];
  const conflicts = [];
  let unchanged = 0;
  items.forEach(item => {
    const current = findRecord(data, item.collection, item.recordId);
    let target;
    if (item.op === 'add') {
      if (!current || current.deleted) { unchanged++; return; }
      target = { ...current, deleted: true };
    } else {
      if (!item.before) return;
      target = item.before;
    }
    if (current && sameContent(current, target)) { unchanged++; return; }
    const record = asNewChange(target, current, now);
    if (current && item.after && !sameContent(current, item.after)) {
      conflicts.push({ item, current, target: record });
      if (!force) return;
    }
    patches.push({ collection: item.collection, id: item.recordId, record });
  });
  return { patches, conflicts, unchanged };
}

// The version of the record this change produced (for a deletion: the last
// version before it), as a new change. Null when the record is already like
// that.
export function restoreVersion(data, item, { now = nowIso() } = {}) {
  const version = item.op === 'delete' ? item.before : item.after;
  if (!version) return null;
  const current = findRecord(data, item.collection, item.recordId);
  if (current && sameContent(current, version)) return null;
  return { collection: item.collection, id: item.recordId, record: asNewChange(version, current, now) };
}

// ---------- keeping the journal small ----------

// Ids of items to drop: everything older than `keepDays`, then the oldest
// steps until at most `maxItems` are left. Whole steps go, so a bulk action
// is never cut in half, and the newest step always stays.
export function pruneIds(items, now = nowIso(), { keepDays = KEEP_DAYS, maxItems = MAX_ITEMS } = {}) {
  const cutoff = new Date(new Date(now).getTime() - keepDays * 86400000).toISOString();
  const batches = groupBatches(items).reverse();
  const drop = [];
  let left = items.length;
  batches.forEach((b, i) => {
    const newest = i === batches.length - 1;
    if (!newest && (b.at < cutoff || left > maxItems)) {
      b.items.forEach(x => drop.push(x.id));
      left -= b.items.length;
    }
  });
  return drop;
}

// ---------- reading ----------

const SOURCE_RANK = { sync: 4, restore: 3, import: 2, local: 1, auto: 0 };

// Steps, newest first. A step's source is the strongest of its items'.
export function groupBatches(items) {
  const map = new Map();
  items.forEach(item => {
    let b = map.get(item.batchId);
    if (!b) {
      b = { batchId: item.batchId, at: item.at, source: item.source, items: [] };
      map.set(item.batchId, b);
    }
    b.items.push(item);
    if (item.at < b.at) b.at = item.at;
    if ((SOURCE_RANK[item.source] ?? 1) > (SOURCE_RANK[b.source] ?? 1)) b.source = item.source;
  });
  return [...map.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function strongestSource(sources) {
  let best = null;
  sources.forEach(s => {
    if (best === null || (SOURCE_RANK[s] ?? 1) > (SOURCE_RANK[best] ?? 1)) best = s;
  });
  return best || 'local';
}

// Local day of a step: people think in their own days, not in UTC.
export function batchDay(batch) {
  return dayKey(new Date(batch.at));
}

export function groupByDay(batches) {
  const days = [];
  batches.forEach(b => {
    const day = batchDay(b);
    const last = days[days.length - 1];
    if (last && last.day === day) last.batches.push(b);
    else days.push({ day, batches: [b] });
  });
  return days;
}

export function filterBatches(batches, { group = '', source = '', query = '' } = {}, data = store.data) {
  const q = query.trim().toLowerCase();
  return batches.filter(b => {
    if (source && b.source !== source) return false;
    if (group && !b.items.some(i => collectionGroup(i.collection) === group)) return false;
    if (!q) return true;
    return b.items.some(i => i.label.toLowerCase().includes(q) || describeChange(i, data).toLowerCase().includes(q));
  });
}

// ---------- describing ----------

function has(key) {
  return key in translations.en;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// "payment", "category", ... A collection the journal has no word for (one
// added by a later version) is named as it is.
export function kindLabel(collection, rec = null) {
  if (collection === 'entries' && rec && (rec.type === 'income' || rec.type === 'transfer')) return t(`journal-kind-entries-${rec.type}`);
  const key = `journal-kind-${collection}`;
  return has(key) ? t(key) : collection;
}

const FIELD_KEYS = {
  amount: 'field-amount', title: 'field-title', name: 'field-name', date: 'field-date', accountId: 'field-account',
  toAccountId: 'field-to-account', categoryId: 'field-category', status: 'field-status', note: 'field-note', tagIds: 'field-tags'
};

export function fieldLabel(field) {
  const key = FIELD_KEYS[field] || `journal-field-${field}`;
  if (has(key)) return lowerFirst(t(key));
  // An unknown field: "monthlyLimit" -> "monthly limit".
  return field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

const MONEY = /^(amount|balance|budget|payment|original|openingBalance|actualBalance|computedBalance|targetAmount|plannedAmount|monthlyLimit|minAmount|maxAmount|rolloverCarry)$/;

// Where an id field points; other *Id fields are looked up everywhere.
const ID_FIELDS = {
  accountId: 'accounts', toAccountId: 'accounts', templateAccountId: 'accounts', categoryId: 'categories',
  templateId: 'templates', goalId: 'goals', debtId: 'debts', adjustmentEntryId: 'entries'
};

function nameOf(data, id, collection) {
  const lists = collection ? [collection] : COLLECTIONS;
  for (const name of lists) {
    const rec = (data[name] || []).find(r => r.id === id);
    if (rec) return recordLabel(rec) || t('untitled');
  }
  return '?';
}

function money(cents) {
  return formatMoney(cents, { currency: store.settings.currency, lang: currentLang() });
}

export function formatValue(field, value, data = store.data) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return t('journal-none');
  if (typeof value === 'boolean') return t(value ? 'journal-yes' : 'journal-no');
  if (typeof value === 'number' && MONEY.test(field)) return money(value);
  if (field === 'status' && has(`status-${value}`)) return t(`status-${value}`);
  if (field === 'type' && has(`type-${value}`)) return t(`type-${value}`);
  if (field === 'tagIds' && Array.isArray(value)) return value.map(id => nameOf(data, id, 'tags')).join(', ');
  if (typeof value === 'string' && /Id$/.test(field)) return nameOf(data, value, ID_FIELDS[field] || null);
  if (typeof value === 'string' && isDayKey(value)) return formatDate(value, currentLang());
  if (typeof value === 'string') return t('journal-quoted', { text: value.length > 40 ? `${value.slice(0, 39)}...` : value });
  if (typeof value === 'number') return String(value);
  return t('journal-changed');
}

// "payment "Rent" 950€"
function subject(item) {
  const rec = item.after && !item.after.deleted ? item.after : item.before || item.after;
  const kind = kindLabel(item.collection, rec);
  const name = item.label || recordLabel(rec);
  let text = name ? t('journal-subject', { kind, name }) : kind;
  if (rec && typeof rec.amount === 'number' && (item.collection === 'entries' || item.collection === 'templates')) {
    text += ` ${money(rec.amount)}`;
  }
  return text;
}

const STATUS_COMPANIONS = new Set(['status', 'date', 'amount']);

export function visibleFields(item) {
  return (item.fields || []).filter(f => !QUIET_FIELDS.has(f));
}

// A short text for one change: 'Payment "Rent" 950€: amount 900€ → 950€',
// 'Payment "Rent" 950€: marked done', 'Deleted category "Hobby"'.
export function describeChange(item, data = store.data) {
  const what = subject(item);
  if (item.op === 'add') return t('journal-added', { what });
  if (item.op === 'delete') return t('journal-deleted', { what });
  if (item.op === 'undelete') return t('journal-undeleted', { what });
  const fields = visibleFields(item);
  const status = item.after && item.after.status;
  if (fields.includes('status') && fields.every(f => STATUS_COMPANIONS.has(f)) && has(`journal-status-${status}`)) {
    return `${capitalize(what)}: ${t(`journal-status-${status}`)}`;
  }
  const shown = (fields.length ? fields : item.fields || []).slice(0, 2).map(f =>
    `${fieldLabel(f)} ${formatValue(f, item.before[f], data)} → ${formatValue(f, item.after[f], data)}`);
  const more = Math.max(0, (fields.length || (item.fields || []).length) - shown.length);
  if (!shown.length) return `${capitalize(what)}: ${t('journal-changed')}`;
  return `${capitalize(what)}: ${shown.join(', ')}${more ? ' ' + t('journal-more-fields', { n: more }) : ''}`;
}

// One line for a whole step.
export function describeBatch(batch, data = store.data) {
  const first = describeChange(batch.items[0], data);
  const rest = batch.items.length - 1;
  return rest ? `${first} ${tn('journal-and-more', rest)}` : first;
}

// The changed fields of one change, for the expanded row.
export function fieldRows(item, data = store.data) {
  if (item.op !== 'edit') return [];
  const fields = visibleFields(item);
  return (fields.length ? fields : item.fields || []).map(f => ({
    field: f,
    label: capitalize(fieldLabel(f)),
    from: formatValue(f, item.before[f], data),
    to: formatValue(f, item.after[f], data)
  }));
}

// What a patch will do to the record now, as a change item (null: nothing).
export function patchChange(patch, data = store.data) {
  const current = findRecord(data, patch.collection, patch.id);
  const change = recordChange(patch.collection, current, patch.record);
  return change ? makeItems([change])[0] : null;
}

export function describePatch(patch, data = store.data) {
  const item = patchChange(patch, data);
  return item ? describeChange(item, data) : '';
}
