// Tags and trip budgets. Pure functions over the budget document: what a
// tag has cost, what is still planned under it and how that compares with
// its budget. A split payment keeps its entry's tags for every part.

import { live } from './model.js';
import { categoryParts } from './splits.js';

export function entryHasTag(entry, tagId) {
  return !!tagId && Array.isArray(entry.tagIds) && entry.tagIds.includes(tagId);
}

// The tag lists after adding or taking away one tag, for the bulk actions.
export function withTag(tagIds, tagId) {
  const list = Array.isArray(tagIds) ? tagIds : [];
  return list.includes(tagId) ? [...list] : [...list, tagId];
}

export function withoutTag(tagIds, tagId) {
  return (Array.isArray(tagIds) ? tagIds : []).filter(id => id !== tagId);
}

// Tags in the order the pickers and analytics show them: the ones in use
// first (not archived), then by name.
export function sortedTags(data, { includeArchived = false } = {}) {
  return live(data && data.tags)
    .filter(tag => includeArchived || !tag.archived)
    .sort((a, b) => (a.archived === b.archived ? 0 : a.archived ? 1 : -1) || a.name.localeCompare(b.name));
}

// Where a tag's dates stand on `today`: before the start, running, or over.
// A tag without dates is simply running.
export function tagPhase(tag, today) {
  if (tag.startDate && today < tag.startDate) return 'upcoming';
  if (tag.endDate && today > tag.endDate) return 'ended';
  return 'active';
}

// The money of one tag. Expenses only count as spent once done; open ones
// (planned or set aside) are what is still to come, cancelled ones nothing.
// Pass-through money and reconciliation adjustments are not spending.
// Returns { spent, planned, total, budget, left, percent, count, refunds,
// byCategory: [{ categoryId, amount }] (done, largest first), phase }.
export function tagSummary(data, tagId, today) {
  const tag = live(data && data.tags).find(x => x.id === tagId) || null;
  const out = {
    tag, spent: 0, planned: 0, total: 0, refunds: 0, count: 0,
    budget: tag && tag.budget > 0 ? tag.budget : null, left: null, percent: null,
    byCategory: [], phase: tag ? tagPhase(tag, today) : 'active'
  };
  const byCategory = new Map();
  live(data && data.entries).forEach(e => {
    if (!entryHasTag(e, tagId) || e.status === 'cancelled' || e.isTransit || e.isAdjustment) return;
    if (e.type === 'income') {
      // A refund for a cancelled hotel night: shown, but the trip's spending
      // stays what was paid.
      if (e.status === 'done') out.refunds += e.amount || 0;
      return;
    }
    if (e.type !== 'expense') return;
    out.count++;
    if (e.status !== 'done') {
      out.planned += e.amount || 0;
      return;
    }
    out.spent += e.amount || 0;
    categoryParts(e).forEach(p => byCategory.set(p.categoryId, (byCategory.get(p.categoryId) || 0) + p.amount));
  });
  out.total = out.spent + out.planned;
  if (out.budget) {
    out.left = out.budget - out.spent;
    out.percent = Math.floor((out.spent / out.budget) * 100);
  }
  out.byCategory = [...byCategory.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .filter(r => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
  return out;
}

// How many entries and templates carry the tag, for the delete question.
export function tagUsage(data, tagId) {
  return {
    entries: live(data && data.entries).filter(e => entryHasTag(e, tagId)).length,
    templates: live(data && data.templates).filter(x => entryHasTag(x, tagId)).length
  };
}
