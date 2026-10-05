// Goals: what the money on an envelope is for (a holiday, a new car), how
// far it is, and how much to set aside per month to make it by the date.

import { store } from '../store.js';
import { t } from '../i18n.js';
import { h, clear, icon, money, refreshIcons, lang, emptyState, field, moneyInput, selectEl, accountOptions, openModal, accountLabel, badge } from '../ui.js';
import { goalProgress } from '../ledger.js';
import { formatDate, isDayKey, todayKey } from '../dates.js';
import { live, makeGoal } from '../model.js';
import { showToast } from '../toast.js';
import { withUndo } from '../modals.js';

let showArchived = false;

export function openGoalModal(goal = null) {
  const isNew = !goal;
  const src = goal || {};
  const name = h('input', { type: 'text', value: src.name || '', placeholder: t('goal-name-placeholder') });
  const target = moneyInput({ value: src.targetAmount || null });
  const account = selectEl(accountOptions({ emptyLabel: t('choose-account') }), src.accountId || '');
  const deadline = h('input', { type: 'date', value: src.deadline || '' });
  const actions = [];
  if (!isNew) {
    actions.push({
      label: t('delete'), kind: 'danger', onClick: (m) => {
        withUndo(t('toast-goal-deleted'), () => store.remove('goals', goal.id));
        m.close();
        return true;
      }
    });
  }
  actions.push({ label: t('cancel'), onClick: (m) => m.close() });
  actions.push({
    label: t('save'), kind: 'primary', onClick: (m) => {
      if (!name.value.trim()) { showToast(t('err-name'), { type: 'error' }); return false; }
      const cents = target.readCents();
      if (cents === null || cents <= 0) { showToast(t('err-amount'), { type: 'error' }); return false; }
      if (!account.value) { showToast(t('goal-need-account'), { type: 'error' }); return false; }
      const patch = {
        name: name.value.trim(),
        targetAmount: cents,
        accountId: account.value,
        deadline: isDayKey(deadline.value) ? deadline.value : null
      };
      if (isNew) store.add('goals', makeGoal(patch));
      else store.update('goals', goal.id, patch);
      m.close();
      return true;
    }
  });
  openModal({
    title: isNew ? t('goal-new') : t('goal-edit'),
    body: h('div', { class: 'form-stack' },
      field(t('field-name'), name),
      h('div', { class: 'form-row' }, field(t('goal-target'), target), field(t('goal-deadline'), deadline, t('goal-deadline-hint'))),
      field(t('goal-account'), account, t('goal-account-hint'))),
    actions
  });
  setTimeout(() => name.focus(), 50);
}

function goalCard(goal, today) {
  const p = goalProgress(store.data, goal, today);
  let plan = null;
  if (p.reached) plan = h('div', { class: 'goal-plan is-reached' }, icon('check-circle-2'), t('goal-reached'));
  else if (p.late) plan = h('div', { class: 'goal-plan is-late' }, icon('alert-triangle'), t('goal-late', { amount: money(p.remaining) }));
  else if (p.perMonth !== null) plan = h('div', { class: 'goal-plan' }, icon('calendar'), t('goal-per-month', { amount: money(p.perMonth), n: p.monthsLeft }));
  return h('div', { class: `card goal-card ${goal.archived ? 'is-archived' : ''}`, ondblclick: () => openGoalModal(goal) },
    h('div', { class: 'goal-head' },
      h('div', {},
        h('h3', { class: 'goal-name' }, goal.name, goal.archived ? badge(t('archived'), 'badge-muted') : null),
        h('div', { class: 'goal-meta' }, [accountLabel(goal.accountId), goal.deadline ? t('goal-by', { date: formatDate(goal.deadline, lang()) }) : null].filter(Boolean).join(' · '))),
      h('div', { class: 'goal-actions' },
        h('button', {
          type: 'button', class: 'icon-btn', title: goal.archived ? t('goal-unarchive') : t('goal-archive'),
          onclick: () => store.update('goals', goal.id, { archived: !goal.archived })
        }, icon(goal.archived ? 'archive-restore' : 'archive')),
        h('button', { type: 'button', class: 'icon-btn', title: t('edit'), onclick: () => openGoalModal(goal) }, icon('pencil')))),
    h('div', { class: 'goal-numbers' },
      h('span', { class: 'goal-saved money' }, money(p.saved)),
      h('span', { class: 'goal-target money' }, t('goal-of', { amount: money(p.target) }))),
    h('div', { class: 'goal-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.percent) },
      h('div', { class: 'goal-bar-fill', style: `width: ${p.percent}%` })),
    h('div', { class: 'goal-foot' },
      h('span', { class: 'muted' }, t('goal-percent', { n: p.percent })),
      p.remaining > 0 ? h('span', { class: 'muted' }, t('goal-left', { amount: money(p.remaining) })) : null),
    plan);
}

export function renderGoals(root) {
  clear(root);
  const today = todayKey();
  const goals = live(store.data.goals || []);
  const visible = goals.filter(g => showArchived || !g.archived)
    .sort((a, b) => (a.archived - b.archived) || (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.name.localeCompare(b.name, lang()));
  const archivedCount = goals.filter(g => g.archived).length;

  root.appendChild(h('div', { class: 'view-header' },
    h('div', {}, h('h1', { class: 'view-title' }, t('nav-goals')), h('p', { class: 'view-subtitle' }, t('goals-subtitle'))),
    h('div', { class: 'header-actions' },
      archivedCount ? h('label', { class: 'checkbox-row' },
        h('input', { type: 'checkbox', checked: showArchived, onchange: (e) => { showArchived = e.target.checked; renderGoals(root); } }),
        h('span', {}, t('goals-show-archived', { n: archivedCount }))) : null,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openGoalModal() }, icon('plus'), t('goal-new')))));

  if (!visible.length) {
    root.appendChild(h('div', { class: 'card' }, emptyState(t('goals-empty'), 'target')));
  } else {
    root.appendChild(h('div', { class: 'goal-grid' }, visible.map(g => goalCard(g, today))));
  }
  root.appendChild(h('p', { class: 'field-hint' }, t('goals-hint')));
  refreshIcons();
}
