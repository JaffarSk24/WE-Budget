// Tags and trips: their management in Settings (name, color, budget,
// dates, archive, delete) and their cards in Analytics (spent, still
// planned, the budget and spending by category inside the tag).

import { store } from '../store.js';
import { t } from '../i18n.js';
import { showToast } from '../toast.js';
import { h, icon, money, moneyInput, selectEl, categoryName, lang } from '../ui.js';
import { makeTag, TAG_COLORS } from '../model.js';
import { isDayKey, formatDayYear, todayKey } from '../dates.js';
import { sortedTags, tagSummary, tagUsage } from '../tags.js';
import { nextTagColor, tagChip } from '../tag-ui.js';

const CATEGORY_ROWS = 6;

function dayInput(value, label, onChange) {
  const input = h('input', { type: 'date', value: value || '', 'aria-label': label, title: label });
  input.addEventListener('change', () => {
    if (input.value && !isDayKey(input.value)) return;
    onChange(input.value || null);
  });
  return input;
}

function deleteTag(tag) {
  const snap = store.snapshot();
  const { entries, templates } = tagUsage(store.data, tag.id);
  store.removeTag(tag.id);
  showToast(t('toast-tag-deleted', { name: tag.name, n: entries + templates }), {
    type: 'success', actionLabel: t('undo'), onAction: () => store.restore(snap)
  });
}

function tagRow(tag) {
  const update = (patch) => store.update('tags', tag.id, patch);
  const name = h('input', { type: 'text', value: tag.name, class: 'inline-input tag-admin-name', 'aria-label': t('field-name') });
  name.addEventListener('change', () => { if (name.value.trim()) update({ name: name.value.trim() }); });
  const color = selectEl(TAG_COLORS.map(c => ({ value: c, label: t(`tag-color-${c}`) })), tag.color, { 'aria-label': t('tag-color'), class: 'tag-admin-color' });
  color.addEventListener('change', () => update({ color: color.value }));
  const budget = moneyInput({ value: tag.budget, placeholder: t('tag-no-budget') });
  budget.classList.add('inline-input', 'tag-admin-budget');
  budget.setAttribute('aria-label', t('tag-budget'));
  budget.addEventListener('change', () => {
    const v = budget.value.trim() ? budget.readCents() : null;
    if (budget.value.trim() && (v === null || v < 0)) { showToast(t('err-amount'), { type: 'error' }); return; }
    update({ budget: v || null });
  });
  const start = dayInput(tag.startDate, t('tag-start'), (v) => update({ startDate: v }));
  const end = dayInput(tag.endDate, t('tag-end'), (v) => {
    if (v && tag.startDate && v < tag.startDate) { showToast(t('err-tag-dates'), { type: 'error' }); end.value = tag.endDate || ''; return; }
    update({ endDate: v });
  });
  return h('div', { class: `tag-admin-row ${tag.archived ? 'is-archived' : ''}` },
    h('span', { class: `tag-dot tag-${tag.color}`, 'aria-hidden': 'true' }),
    name, color, budget,
    h('div', { class: 'tag-admin-dates' }, start, h('span', { class: 'muted' }, '-'), end),
    h('div', { class: 'tag-admin-actions' },
      h('button', {
        type: 'button', class: 'icon-btn', title: tag.archived ? t('tag-unarchive') : t('tag-archive'),
        'aria-label': tag.archived ? t('tag-unarchive') : t('tag-archive'),
        onclick: () => update({ archived: !tag.archived })
      }, icon(tag.archived ? 'archive-restore' : 'archive')),
      h('button', {
        type: 'button', class: 'icon-btn danger', title: t('delete'), 'aria-label': t('delete'),
        onclick: () => deleteTag(tag)
      }, icon('trash-2'))));
}

// `section` is the settings card builder, `rerender` draws the screen again
// after a tag is added (the store change alone does that too, but the new
// name field has to be empty at once).
export function tagsSection(section, rerender) {
  const tags = sortedTags(store.data, { includeArchived: true });
  const newName = h('input', { type: 'text', placeholder: t('tag-new-placeholder'), 'aria-label': t('tag-new') });
  const add = () => {
    const name = newName.value.trim();
    if (!name) return;
    store.add('tags', makeTag({ name, color: nextTagColor() }));
    rerender();
  };
  newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return section(t('settings-tags'), 'tag',
    h('p', { class: 'setting-hint' }, t('settings-tags-hint')),
    tags.length ? h('div', { class: 'tag-admin' },
      h('div', { class: 'tag-admin-head' },
        h('span', {}), h('span', {}, t('field-name')), h('span', {}, t('tag-color')), h('span', {}, t('tag-budget')),
        h('span', {}, t('tag-dates')), h('span', {})),
      tags.map(tagRow)) : null,
    h('div', { class: 'inline-add' }, newName, h('button', { type: 'button', class: 'btn btn-secondary', onclick: add }, icon('plus'), t('add'))));
}

// ---------- analytics ----------

function datesText(tag) {
  const d = (day) => formatDayYear(day, lang());
  if (tag.startDate && tag.endDate) return t('tag-dates-range', { from: d(tag.startDate), to: d(tag.endDate) });
  if (tag.startDate) return t('tag-dates-from', { from: d(tag.startDate) });
  if (tag.endDate) return t('tag-dates-to', { to: d(tag.endDate) });
  return null;
}

function tagCard(tag, today) {
  const s = tagSummary(store.data, tag.id, today);
  const over = s.budget !== null && s.spent > s.budget;
  const width = s.budget ? Math.min(100, Math.round((s.spent / s.budget) * 100)) : 0;
  const plannedWidth = s.budget ? Math.min(100 - width, Math.round((s.planned / s.budget) * 100)) : 0;
  const dates = datesText(tag);
  return h('div', { class: `tag-card ${over ? 'is-over' : ''}` },
    h('div', { class: 'tag-card-head' },
      tagChip(tag, { small: false }),
      h('span', { class: `badge tag-phase-${s.phase}` }, t(`tag-phase-${s.phase}`))),
    dates ? h('div', { class: 'tag-card-dates muted small' }, icon('calendar', 'inline-icon'), ' ', dates) : null,
    h('div', { class: 'tag-card-numbers' },
      h('span', { class: 'tag-card-spent money' }, money(s.spent)),
      s.budget !== null ? h('span', { class: 'tag-card-budget money' }, t('tag-of-budget', { amount: money(s.budget) })) : null),
    s.budget !== null ? h('div', { class: 'goal-bar tag-bar', role: 'img', 'aria-label': t('tag-percent', { n: s.percent }) },
      h('div', { class: 'goal-bar-fill', style: `width: ${width}%` }),
      plannedWidth ? h('div', { class: 'goal-bar-fill tag-bar-planned', style: `width: ${plannedWidth}%` }) : null) : null,
    h('div', { class: 'tag-card-foot small' },
      s.budget !== null ? h('span', { class: over ? 'an-over' : 'muted' },
        over ? t('tag-over', { amount: money(s.spent - s.budget), n: s.percent }) : t('tag-left', { amount: money(s.left), n: s.percent })) : null,
      s.planned ? h('span', { class: 'muted' }, t('tag-planned', { amount: money(s.planned) })) : null,
      s.refunds ? h('span', { class: 'muted' }, t('tag-refunds', { amount: money(s.refunds) })) : null),
    s.byCategory.length ? h('table', { class: 'an-table tag-card-cats' },
      h('tbody', {}, s.byCategory.slice(0, CATEGORY_ROWS).map(r => h('tr', {},
        h('td', {}, r.categoryId ? categoryName(r.categoryId) : t('no-category')),
        h('td', { class: 'num money' }, money(r.amount)),
        h('td', { class: 'num muted' }, s.spent ? `${Math.round((r.amount / s.spent) * 100)}%` : ''))))) : null,
    !s.count ? h('p', { class: 'muted small' }, t('tag-empty')) : null);
}

// One card per tag that is not archived; null when there are none.
export function tagsAnalyticsCard(today = todayKey()) {
  const tags = sortedTags(store.data);
  if (!tags.length) return null;
  return h('div', { class: 'card' },
    h('div', { class: 'card-title-row' }, icon('tag'), h('h3', {}, t('an-tags-title'))),
    h('p', { class: 'field-hint' }, t('an-tags-hint')),
    h('div', { class: 'tag-cards' }, tags.map(tag => tagCard(tag, today))));
}
