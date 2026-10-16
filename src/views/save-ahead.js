// Saving ahead for a payment that does not come every month (car
// insurance once a year, water every two months): a goal on its own account
// or envelope that follows the payment's next occurrence, filled by a
// monthly contribution. The payment is then paid from that account.

import { store } from '../store.js';
import { t } from '../i18n.js';
import { h, field, moneyInput, selectEl, accountOptions, openModal, money, lang } from '../ui.js';
import { centsToInput } from '../money.js';
import { goalContribution, goalProgress, saveAheadDeadline, saveAheadGoal, suggestedContribution } from '../ledger.js';
import { formatDate, todayKey } from '../dates.js';
import { live } from '../model.js';
import { showToast } from '../toast.js';
import { withUndo } from '../modals.js';

// The account and its envelopes: money moved between them stays where it was.
function accountGroup(accountId) {
  return new Set([accountId, ...live(store.data.accounts).filter(a => a.parentId === accountId).map(a => a.id)]);
}

// A savings account or envelope no other goal uses yet is the natural place.
function defaultTarget(options, template) {
  const used = new Set(live(store.data.goals).filter(g => !g.archived).map(g => g.accountId));
  const free = options.filter(o => o.value && o.value !== template.accountId && !used.has(o.value));
  const savings = free.find(o => (store.find('accounts', o.value) || {}).kind === 'savings');
  return (savings || {}).value || '';
}

function nextIncomeDay(today) {
  const income = live(store.data.entries)
    .filter(e => e.type === 'income' && e.status === 'planned' && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return income ? Number(income.date.slice(8, 10)) : 1;
}

// One line for the Recurring screen: how far the saving is.
export function saveAheadSummary(goal, today = todayKey()) {
  const p = goalProgress(store.data, goal, today);
  const c = goalContribution(store.data, goal);
  const params = { saved: money(Math.max(0, p.saved)), target: money(p.target) };
  return c ? t('save-ahead-progress', { ...params, amount: money(c.amount) }) : t('save-ahead-progress-plain', params);
}

export function stopSaveAhead(goal) {
  withUndo(t('toast-save-ahead-off'), () => store.stopSaveAhead(goal.id));
}

export function openSaveAheadModal(template) {
  const today = todayKey();
  const existing = saveAheadGoal(store.data, template.id);
  if (existing) return;
  const deadline = saveAheadDeadline(store.data, template, today);
  if (!deadline) {
    showToast(t('save-ahead-no-date'), { type: 'error' });
    return;
  }
  const options = accountOptions({ emptyLabel: t('choose-account') });
  const target = selectEl(options.filter(o => o.value !== template.accountId), defaultTarget(options, template));
  const from = selectEl(options, template.accountId || '');
  const day = h('input', { type: 'number', min: '1', max: '31', step: '1', value: String(nextIncomeDay(today)) });
  const amount = moneyInput();
  const hint = h('div', { class: 'field-hint' });

  // Not stored yet: an id no contribution points to.
  const draft = () => ({ id: 'save-ahead-draft', templateId: template.id, targetAmount: template.amount, accountId: target.value || null, deadline });
  // The amount follows the suggestion until it is typed over.
  let suggested = null;
  const suggest = () => {
    const d = Math.min(31, Math.max(1, Math.round(Number(day.value)) || 1));
    const date = formatDate(deadline, lang());
    let s = null;
    if (!target.value) hint.textContent = t('save-ahead-pick', { amount: money(template.amount), date });
    else {
      s = suggestedContribution(store.data, draft(), today, d);
      if (s.need === 0) hint.textContent = t('save-ahead-covered', { date });
      else if (!s.count) hint.textContent = t('save-ahead-too-late', { date });
      else hint.textContent = t('save-ahead-hint', { amount: money(s.amount), n: s.count, target: money(template.amount), date });
    }
    const value = s && s.count && s.amount > 0 ? s.amount : null;
    if (amount.value === '' || amount.readCents() === suggested) {
      amount.value = value ? centsToInput(value, lang()) : '';
    }
    suggested = value;
  };
  day.addEventListener('input', suggest);
  target.addEventListener('change', suggest);
  suggest();

  openModal({
    title: t('save-ahead-title', { name: template.title }),
    body: h('div', { class: 'form-stack' },
      h('p', { class: 'field-hint' }, t('save-ahead-info')),
      field(t('save-ahead-account'), target, t('save-ahead-account-hint')),
      field(t('save-ahead-from'), from),
      h('div', { class: 'form-row' }, field(t('save-ahead-day'), day), field(t('save-ahead-amount'), amount)),
      hint),
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: t('save-ahead'), kind: 'primary', onClick: (m) => {
          const d = Number(day.value);
          const cents = amount.value.trim() === '' ? 0 : amount.readCents();
          if (!target.value) { showToast(t('save-ahead-err-account'), { type: 'error' }); return false; }
          if (!from.value) { showToast(t('err-account'), { type: 'error' }); return false; }
          if (accountGroup(target.value).has(from.value)) { showToast(t('save-ahead-err-same'), { type: 'error' }); return false; }
          if (!Number.isInteger(d) || d < 1 || d > 31) { showToast(t('goal-contribution-err-day'), { type: 'error' }); return false; }
          if (cents === null || cents < 0) { showToast(t('err-amount'), { type: 'error' }); return false; }
          withUndo(t('toast-save-ahead-on', { name: template.title }), () => store.startSaveAhead(template.id, {
            accountId: target.value,
            fromAccountId: from.value,
            day: d,
            amount: cents,
            name: template.title,
            contributionTitle: t('goal-contribution-title', { name: template.title })
          }));
          m.close();
          return true;
        }
      }
    ]
  });
}
