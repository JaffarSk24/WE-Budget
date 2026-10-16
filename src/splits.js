// Split payments: one bank payment spread over several categories (a
// supermarket receipt with groceries, household goods and something for the
// kids). The entry keeps one amount and one account, so balances and the
// budget see one payment; only the per-category figures look at the parts.
//
// entry.splits: [{ categoryId, amount (cents, > 0), note }]. The parts add
// up to the entry's amount, and the entry's own categoryId is the largest
// part, so code that knows nothing about splits still sees a sensible
// category.

// Only expenses and incomes are split; a transfer has no category.
export function canSplit(entry) {
  return !!entry && (entry.type === 'expense' || entry.type === 'income');
}

export function hasSplits(entry) {
  return canSplit(entry) && Array.isArray(entry.splits) && entry.splits.length > 0;
}

export function splitsTotal(splits) {
  return (splits || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

// Index of the largest part; the first one wins a tie, so the entry's
// category stays put when two parts are equal.
function largestIndex(splits) {
  let best = 0;
  splits.forEach((p, i) => { if ((p.amount || 0) > (splits[best].amount || 0)) best = i; });
  return best;
}

export function largestPart(splits) {
  return splits && splits.length ? splits[largestIndex(splits)] : null;
}

// The parts scaled to a new total, in proportion. Rounding to cents leaves
// a cent or two over or short; the largest part takes the difference, where
// it changes the shares the least. Parts that were all zero share nothing,
// so the whole new total goes to the first one.
export function rescaleSplits(splits, amount) {
  const list = (splits || []).map(p => ({ ...p, amount: Math.max(0, Math.round(Number(p.amount) || 0)) }));
  if (!list.length) return list;
  const total = Math.max(0, Math.round(Number(amount) || 0));
  const old = splitsTotal(list);
  if (old === total) return list;
  if (old === 0) {
    list.forEach((p, i) => { p.amount = i === 0 ? total : 0; });
    return list;
  }
  const big = largestIndex(list);
  list.forEach(p => { p.amount = Math.round((p.amount * total) / old); });
  list[big].amount += total - splitsTotal(list);
  return list;
}

// What one entry brings to each category: its parts when it is split, the
// whole amount in its own category otherwise. Parts that drifted from the
// amount (two devices editing at once) are scaled back onto it, so the
// category figures always add up to what left the account.
export function categoryParts(entry) {
  if (!hasSplits(entry)) return [{ categoryId: entry.categoryId || null, amount: entry.amount || 0 }];
  const parts = splitsTotal(entry.splits) === (entry.amount || 0) ? entry.splits : rescaleSplits(entry.splits, entry.amount || 0);
  return parts.map(p => ({ categoryId: p.categoryId || null, amount: p.amount || 0 }));
}

// The fields to store for a set of parts typed in the dialog: clean parts
// and the category of the largest one. Fewer than two parts is no split.
export function splitFields(splits, fallbackCategoryId = null) {
  const clean = (splits || [])
    .map(p => ({ categoryId: p.categoryId || null, amount: Math.round(Number(p.amount) || 0), note: String(p.note || '').trim() }))
    .filter(p => p.amount > 0);
  if (clean.length < 2) {
    return { splits: null, categoryId: clean.length ? clean[0].categoryId : fallbackCategoryId };
  }
  return { splits: clean, categoryId: largestPart(clean).categoryId };
}

// Keeps a split entry consistent after its amount changed (an edit in
// place, marking done with another amount, a bank import): returns the
// fields to set, or null when nothing is to change.
export function fitSplits(entry) {
  if (!hasSplits(entry)) return null;
  if (splitsTotal(entry.splits) === (entry.amount || 0)) return null;
  const splits = rescaleSplits(entry.splits, entry.amount || 0);
  return { splits, categoryId: largestPart(splits).categoryId };
}

// What the dialog still has to spread: positive while parts are missing,
// negative when they add up to more than the payment.
export function splitRemainder(amount, splits) {
  return (amount || 0) - splitsTotal(splits);
}

// Lines of the CSV export for one entry: one per part, each with "2/3" to
// show which payment it belongs to; a payment without parts is one line
// with an empty mark. The note of a part falls back to the entry's note.
export function csvParts(entry) {
  if (!hasSplits(entry)) return [{ categoryId: entry.categoryId || null, amount: entry.amount || 0, note: entry.note || '', part: '' }];
  const parts = categoryParts(entry);
  return parts.map((p, i) => ({
    categoryId: p.categoryId,
    amount: p.amount,
    note: (entry.splits[i] && entry.splits[i].note) || entry.note || '',
    part: `${i + 1}/${parts.length}`
  }));
}
