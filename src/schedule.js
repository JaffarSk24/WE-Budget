// Recurring templates and the entries they generate. Generation is
// idempotent: an occurrence is identified by templateId + scheduled day, and
// an entry that was deleted or moved still blocks its occurrence from being
// created again.

import { live, makeEntry } from './model.js';
import {
  addDays, addMonthsToMonth, dayInMonth, lastDayOfMonth, monthOf, monthsBetween,
  weekdayIndex
} from './dates.js';

// All scheduled days of a schedule within [from, to].
export function occurrences(schedule, from, to) {
  const start = schedule.startDate || from;
  const lo = start > from ? start : from;
  const hi = schedule.endDate && schedule.endDate < to ? schedule.endDate : to;
  if (lo > hi) return [];

  const days = [];
  switch (schedule.freq) {
    case 'once':
      if (start >= lo && start <= hi) days.push(start);
      break;

    case 'weekly': {
      const weekdays = schedule.weekdays && schedule.weekdays.length
        ? schedule.weekdays
        : [weekdayIndex(start)];
      for (let d = lo; d <= hi; d = addDays(d, 1)) {
        if (weekdays.includes(weekdayIndex(d))) days.push(d);
      }
      break;
    }

    case 'yearly': {
      const anchorMonth = Number(start.slice(5, 7));
      for (let y = Number(lo.slice(0, 4)); y <= Number(hi.slice(0, 4)); y++) {
        const d = dayInMonth(`${y}-${String(anchorMonth).padStart(2, '0')}`, schedule.day);
        if (d >= lo && d <= hi) days.push(d);
      }
      break;
    }

    case 'monthly':
    case 'everyNMonths':
    default: {
      const step = schedule.freq === 'everyNMonths' ? Math.max(1, schedule.interval || 1) : 1;
      const anchor = monthOf(start);
      for (let m = monthOf(lo); m <= monthOf(hi); m = addMonthsToMonth(m, 1)) {
        if (monthsBetween(anchor, m) % step !== 0) continue;
        const d = dayInMonth(m, schedule.day);
        if (d >= lo && d <= hi) days.push(d);
      }
      break;
    }
  }
  return days;
}

// Last day that templates should already have produced entries for:
// the end of the month `months` months after today's month.
export function generationHorizon(today, months) {
  return lastDayOfMonth(addMonthsToMonth(monthOf(today), months));
}

export function entryFromTemplate(template, day) {
  return makeEntry({
    templateId: template.id,
    occurrence: day,
    date: day,
    title: template.title,
    type: template.type,
    plannedAmount: template.amount,
    amount: template.amount,
    accountId: template.accountId,
    toAccountId: template.type === 'transfer' ? template.toAccountId : null,
    categoryId: template.categoryId,
    isTransit: template.isTransit,
    status: 'planned'
  });
}

// Returns what is missing up to `horizon`: new entries and the new
// generatedThrough mark per template. Does not modify `data`.
export function pendingGeneration(data, today, horizon) {
  const existing = new Set(
    (data.entries || [])
      .filter(e => e.templateId)
      .map(e => `${e.templateId}|${e.occurrence || e.date}`)
  );
  const entries = [];
  const marks = [];

  live(data.templates).forEach(t => {
    if (!t.active) return;
    const from = t.generatedThrough
      ? addDays(t.generatedThrough, 1)
      : (t.schedule.startDate || today);
    if (from > horizon) return;
    occurrences(t.schedule, from, horizon).forEach(day => {
      const key = `${t.id}|${day}`;
      if (existing.has(key)) return;
      existing.add(key);
      entries.push(entryFromTemplate(t, day));
    });
    marks.push({ id: t.id, generatedThrough: horizon });
  });
  return { entries, marks };
}

// Future open entries of a template, the ones that follow its edits.
export function futureOpenEntries(data, templateId, today) {
  return live(data.entries).filter(e =>
    e.templateId === templateId && e.status === 'planned' && e.date >= today);
}
