// Merging two copies of the same budget, record by record.
//
// Every record carries updatedAt; the newer copy of a record wins. Deleted
// records are tombstones, so a deletion travels like any other change.
// The result does not depend on which side is called local and which remote:
// two devices merging the same pair end up with the same document.

import { COLLECTIONS, hasAnyData, nowIso } from '../model.js';
import { canonical } from './hash.js';

const STATUS_RANK = { done: 3, reserved: 2, cancelled: 1, planned: 0 };

function newer(a, b) {
  if ((a.updatedAt || '') > (b.updatedAt || '')) return a;
  if ((a.updatedAt || '') < (b.updatedAt || '')) return b;
  // Same timestamp, different content: pick by content so both sides agree.
  return canonical(a) >= canonical(b) ? a : b;
}

function laterDay(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

// Two devices that generate the plan before they have synced create the same
// template occurrence twice. Keep the one that went furthest (done over
// reserved over planned), then the older one; tombstone the rest.
export function dedupeOccurrences(entries, now = nowIso()) {
  const groups = new Map();
  entries.forEach((e, index) => {
    if (e.deleted || !e.templateId || !e.occurrence) return;
    const key = `${e.templateId}|${e.occurrence}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  const result = entries.slice();
  let removed = 0;
  groups.forEach(indexes => {
    if (indexes.length < 2) return;
    const sorted = indexes.slice().sort((i, j) => {
      const a = entries[i];
      const b = entries[j];
      return (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0)
        || (a.createdAt || '').localeCompare(b.createdAt || '')
        || a.id.localeCompare(b.id);
    });
    sorted.slice(1).forEach(i => {
      result[i] = { ...entries[i], deleted: true, updatedAt: now };
      removed++;
    });
  });
  return { entries: result, removed };
}

export function mergeBudgets(local, remote, now = nowIso()) {
  let localChanged = false;
  let remoteChanged = false;
  const out = { ...local };

  COLLECTIONS.forEach(name => {
    const mine = local[name] || [];
    const theirs = new Map((remote[name] || []).map(r => [r.id, r]));
    const merged = [];
    const seen = new Set();

    mine.forEach(l => {
      seen.add(l.id);
      const r = theirs.get(l.id);
      if (!r) {
        merged.push(l);
        remoteChanged = true;
        return;
      }
      let rec = newer(l, r);
      if (name === 'templates') {
        // Generation bookkeeping travels separately from edits: whichever
        // device generated further ahead, nobody generates those days again.
        const through = laterDay(l.generatedThrough, r.generatedThrough);
        if (through !== rec.generatedThrough) rec = { ...rec, generatedThrough: through };
      }
      const recKey = canonical(rec);
      if (recKey !== canonical(l)) localChanged = true;
      if (recKey !== canonical(r)) remoteChanged = true;
      merged.push(rec);
    });
    (remote[name] || []).forEach(r => {
      if (seen.has(r.id)) return;
      merged.push(r);
      localChanged = true;
    });
    out[name] = merged;
  });

  const settings = newer(local.settings || {}, remote.settings || {});
  if (canonical(settings) !== canonical(local.settings || {})) localChanged = true;
  if (canonical(settings) !== canonical(remote.settings || {})) remoteChanged = true;
  out.settings = settings;
  out.schemaVersion = Math.max(local.schemaVersion || 1, remote.schemaVersion || 1);

  const deduped = dedupeOccurrences(out.entries, now);
  if (deduped.removed) {
    out.entries = deduped.entries;
    localChanged = true;
    remoteChanged = true;
  }
  return { data: out, localChanged, remoteChanged };
}

// What to do when the cloud copy is fetched. `state` is what this device
// remembers about the last successful sync.
//   merge        same budget on both sides
//   take-remote  this device has nothing yet, or the other device replaced
//                the budget after this one last synced
//   keep-local   the cloud is empty, or this device replaced the budget
//   ask          two different budgets met for the first time
export function decideDataset(local, remote, state = {}) {
  if (local.datasetId && local.datasetId === remote.datasetId) return 'merge';
  if (!hasAnyData(local)) return 'take-remote';
  if (!hasAnyData(remote)) return 'keep-local';
  if (state.datasetId && state.datasetId === remote.datasetId) return 'keep-local';
  if (state.datasetId && state.datasetId === local.datasetId) return 'take-remote';
  return 'ask';
}
