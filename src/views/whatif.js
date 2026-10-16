// What-if drafts on the overview forecast: "what if I buy a laptop in
// December, or start paying for a gym?" Drafts live in their own collection
// and only the forecast chart looks at them; "Add to the plan" turns one
// into a real planned entry or a monthly template.

import { store } from '../store.js';
import { t, tn } from '../i18n.js';
import { showToast } from '../toast.js';
import { h, clear, field, selectEl, moneyInput, openModal, money, accountOptions, accountLabel, categoryOptions, categoryName, icon, refreshIcons, lang, emptyState } from '../ui.js';
import { segmented, withUndo } from '../modals.js';
import { makeEntry, makeScenario, makeTemplate } from '../model.js';
import { addMonthsToMonth, dayInMonth, formatDate, formatDay, isDayKey, monthOf, todayKey } from '../dates.js';

function fail(message) {
  showToast(message, { type: 'error' });
  return false;
}

// "Once on 12.12" or "Monthly from 25.10, 6 months".
function scenarioWhen(s) {
  const day = formatDay(s.date, lang());
  if (s.repeat !== 'monthly') return t('whatif-when-once', { date: day });
  return s.months ? t('whatif-when-monthly-n', { date: day, months: tn('whatif-months', s.months) }) : t('whatif-when-monthly', { date: day });
}

export function openScenarioModal(scenario = null, { onSaved = null } = {}) {
  const isNew = !scenario;
  const src = scenario || makeScenario({ date: todayKey(), accountId: store.settings.defaultIncomeAccountId || null });
  let type = src.type;

  const title = h('input', { type: 'text', value: src.title, placeholder: t('whatif-title-placeholder') });
  const amount = moneyInput({ value: isNew ? null : src.amount });
  const date = h('input', { type: 'date', value: src.date || todayKey() });
  const repeat = selectEl([
    { value: 'once', label: t('whatif-repeat-once') },
    { value: 'monthly', label: t('whatif-repeat-monthly') }
  ], src.repeat);
  const months = h('input', { type: 'number', min: 1, max: 120, step: 1, value: src.months || '', placeholder: t('whatif-months-placeholder') });
  const account = selectEl(accountOptions({ emptyLabel: t('choose-account') }), src.accountId || '');
  const category = h('select');
  const monthsField = field(t('whatif-months-field'), months, t('whatif-months-hint'));

  function syncType() {
    clear(category);
    categoryOptions(type, { emptyLabel: t('no-category') }).forEach(o => category.appendChild(h('option', { value: o.value }, o.label)));
    category.value = src.type === type ? (src.categoryId || '') : '';
  }
  function syncRepeat() {
    monthsField.style.display = repeat.value === 'monthly' ? '' : 'none';
  }
  repeat.addEventListener('change', syncRepeat);

  const body = h('div', { class: 'form-stack' },
    segmented([
      { value: 'expense', label: t('type-expense') },
      { value: 'income', label: t('type-income') }
    ], type, (v) => { type = v; syncType(); }),
    field(t('field-title'), title),
    h('div', { class: 'form-row' }, field(t('field-amount'), amount), field(t('field-date'), date)),
    h('div', { class: 'form-row' }, field(t('whatif-repeat'), repeat), monthsField),
    h('div', { class: 'form-row' }, field(t('field-account'), account), field(t('field-category'), category)),
    h('p', { class: 'field-hint' }, t('whatif-not-in-plan')));
  syncType();
  syncRepeat();
  if (isNew) setTimeout(() => title.focus(), 40);

  openModal({
    title: isNew ? t('whatif-new') : t('whatif-edit'),
    body,
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: t('save'), kind: 'primary', onClick: (m) => {
          const cents = amount.readCents();
          if (!title.value.trim()) return fail(t('whatif-err-title'));
          if (cents === null || cents <= 0) return fail(t('err-amount'));
          if (!isDayKey(date.value)) return fail(t('err-date'));
          if (!account.value) return fail(t('err-account'));
          const n = Number(months.value);
          const fields = {
            title: title.value.trim(),
            type,
            amount: cents,
            date: date.value,
            repeat: repeat.value,
            months: repeat.value === 'monthly' && Number.isInteger(n) && n > 0 ? n : null,
            accountId: account.value,
            categoryId: category.value || null
          };
          if (isNew) store.add('scenarios', makeScenario({ ...fields, active: true }));
          else store.update('scenarios', src.id, fields);
          m.close();
          if (onSaved) onSaved();
          return true;
        }
      }
    ]
  });
}

// Turns a draft into the real thing and drops the draft, in one undo step:
// a one-off becomes a planned entry, a monthly one a recurring payment
// (with an end date when it runs for a set number of months).
export function addScenarioToPlan(scenario) {
  if (!scenario.accountId || !store.find('accounts', scenario.accountId)) {
    fail(t('err-account'));
    openScenarioModal(scenario);
    return;
  }
  const name = scenario.title || t('untitled');
  withUndo(t(scenario.repeat === 'monthly' ? 'whatif-toast-template' : 'whatif-toast-entry', { name }), () => {
    const common = {
      title: scenario.title, type: scenario.type, amount: scenario.amount,
      accountId: scenario.accountId, categoryId: scenario.categoryId
    };
    if (scenario.repeat === 'monthly') {
      const day = Number(scenario.date.slice(8, 10));
      const endDate = scenario.months ? dayInMonth(addMonthsToMonth(monthOf(scenario.date), scenario.months - 1), day) : null;
      // Months already behind are not paid after the fact, as in the forecast.
      const startDate = scenario.date < todayKey() ? todayKey() : scenario.date;
      store.saveTemplate(makeTemplate({ ...common, schedule: { freq: 'monthly', day, startDate, endDate } }));
    } else {
      store.add('entries', makeEntry({ ...common, date: scenario.date, plannedAmount: scenario.amount, status: 'planned' }));
    }
    store.remove('scenarios', scenario.id);
  });
}

function scenarioRow(s, refresh) {
  const toggle = h('input', { type: 'checkbox', checked: s.active, 'aria-label': t('whatif-toggle') });
  toggle.addEventListener('change', () => { store.update('scenarios', s.id, { active: toggle.checked }); refresh(); });
  const sign = s.type === 'income' ? 1 : -1;
  const meta = [scenarioWhen(s), accountLabel(s.accountId), s.categoryId ? categoryName(s.categoryId) : null].filter(Boolean).join(' · ');
  const button = (iconName, label, onClick, cls = 'icon-btn') =>
    h('button', { type: 'button', class: cls, title: label, 'aria-label': label, onclick: onClick }, icon(iconName));
  return h('div', { class: `whatif-row ${s.active ? '' : 'is-off'}` },
    h('label', { class: 'whatif-toggle', title: t('whatif-toggle') }, toggle),
    h('div', { class: 'whatif-main' },
      h('span', { class: 'whatif-title' }, s.title || t('untitled')),
      h('span', { class: 'whatif-meta' }, meta)),
    h('span', { class: `whatif-amount money ${sign > 0 ? 'positive' : ''}` }, money(sign * s.amount, { signed: sign > 0 })),
    h('div', { class: 'whatif-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', title: t('whatif-to-plan-hint'), onclick: () => { addScenarioToPlan(s); refresh(); } },
        icon('calendar-check'), t('whatif-to-plan')),
      button('pencil', t('edit'), () => openScenarioModal(s, { onSaved: refresh })),
      button('trash-2', t('delete'), () => { withUndo(t('whatif-toast-deleted'), () => store.remove('scenarios', s.id)); refresh(); }, 'icon-btn danger')));
}

// The list of drafts. It stays open while the chart behind it follows
// every switch, so the effect is visible at once.
export function openWhatIfModal() {
  const list = h('div', { class: 'whatif-list' });
  const refresh = () => {
    const drafts = store.list('scenarios').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt < b.createdAt ? -1 : 1));
    clear(list);
    if (!drafts.length) list.appendChild(emptyState(t('whatif-empty'), 'sparkles'));
    else drafts.forEach(s => list.appendChild(scenarioRow(s, refresh)));
    refreshIcons();
  };
  const unsubscribe = store.subscribe(() => refresh());
  const body = h('div', { class: 'whatif-body' },
    h('p', { class: 'muted small' }, t('whatif-intro')),
    list,
    h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openScenarioModal(null, { onSaved: refresh }) }, icon('plus'), t('whatif-add')));
  refresh();
  openModal({ title: t('whatif-title'), body, wide: true, className: 'whatif-modal', onClose: unsubscribe });
}

// The line under the chart: what the active drafts do to free money.
export function scenarioImpactLine(impact) {
  if (!impact.active) return null;
  const l = lang();
  const diff = impact.endDifference;
  const legend = h('span', { class: 'whatif-legend' },
    h('span', { class: 'whatif-swatch whatif-swatch-real' }), t('whatif-legend-real'),
    h('span', { class: 'whatif-swatch whatif-swatch-draft' }), t('whatif-legend-drafts'));
  const text = impact.firstNegative
    ? t('whatif-impact-negative', { date: formatDate(impact.firstNegative.day, l), amount: money(impact.lowest.value), lowDate: formatDate(impact.lowest.day, l) })
    : t('whatif-impact', { amount: money(impact.lowest.value), date: formatDate(impact.lowest.day, l) });
  return h('div', { class: `whatif-impact ${impact.firstNegative ? 'is-negative' : ''}`, role: 'status' },
    impact.firstNegative ? icon('alert-triangle') : icon('sparkles'),
    h('span', { class: 'whatif-impact-text' }, text,
      diff ? h('span', { class: 'muted' }, ' ', t('whatif-impact-end', { amount: money(diff, { signed: true }) })) : null),
    legend);
}
