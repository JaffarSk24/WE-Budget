// Goals: what the money on an envelope is for (a holiday, a new car), how
// far it is, and how much to set aside per month to make it by the date. A
// goal can put its monthly contribution into the plan: a recurring transfer
// to its envelope until the deadline, linked to the goal by goalId.

import { store } from '../store.js';
import { t } from '../i18n.js';
import { h, clear, icon, money, refreshIcons, lang, emptyState, field, moneyInput, selectEl, accountOptions, openModal, accountLabel, badge } from '../ui.js';
import { centsToInput } from '../money.js';
import { goalContribution, goalOutlook, raisedContribution, suggestedContribution } from '../ledger.js';
import { formatDate, isDayKey, todayKey } from '../dates.js';
import { live, makeGoal, makeTemplate } from '../model.js';
import { showToast } from '../toast.js';
import { withUndo } from '../modals.js';
import { describeSchedule } from './templates.js';

let showArchived = false;

function contributionTitle(name) {
  return t('goal-contribution-title', { name });
}

// The goal's contribution follows the goal: its name in the title (unless
// the title was changed by hand), its envelope and its deadline.
function followGoal(goal, patch) {
  const c = goalContribution(store.data, goal);
  if (!c) return;
  const title = c.title === contributionTitle(goal.name) ? contributionTitle(patch.name) : c.title;
  const endDate = patch.deadline || null;
  const scheduleChanged = (c.schedule.endDate || null) !== endDate;
  if (title === c.title && c.toAccountId === patch.accountId && !scheduleChanged) return;
  store.saveTemplate({ ...c, title, toAccountId: patch.accountId, schedule: { ...c.schedule, endDate } },
    { applyToFuture: true, scheduleChanged });
}

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
        withUndo(t('toast-goal-deleted'), () => {
          const c = goalContribution(store.data, goal);
          store.remove('goals', goal.id);
          if (c) store.removeTemplate(c.id, { removeFuture: true });
        });
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
      if (isNew) {
        store.add('goals', makeGoal(patch));
      } else {
        followGoal(goal, patch);
        store.update('goals', goal.id, patch);
      }
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

function nextIncome(today) {
  return live(store.data.entries)
    .filter(e => e.type === 'income' && e.status === 'planned' && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

// Money for the goal usually comes from the account the envelope belongs
// to, otherwise from where the next income lands.
function defaultSource(goal, options, today) {
  const has = id => id && options.some(o => o.value === id);
  const envelope = store.find('accounts', goal.accountId);
  if (envelope && has(envelope.parentId)) return envelope.parentId;
  const income = nextIncome(today);
  if (income && has(income.accountId)) return income.accountId;
  return (options.find(o => o.value) || {}).value || '';
}

function removeContribution(c) {
  withUndo(t('toast-contribution-removed'), () => store.removeTemplate(c.id, { removeFuture: true }));
}

export function openContributionModal(goal) {
  const today = todayKey();
  const current = goalContribution(store.data, goal);
  const goalAccounts = new Set([goal.accountId, ...live(store.data.accounts).filter(a => a.parentId === goal.accountId).map(a => a.id)]);
  const options = accountOptions({ emptyLabel: t('choose-account') }).filter(o => !goalAccounts.has(o.value));
  const from = selectEl(options, current ? current.accountId : defaultSource(goal, options, today));
  const income = nextIncome(today);
  const day = h('input', {
    type: 'number', min: '1', max: '31', step: '1',
    value: String(current ? current.schedule.day : (income ? Number(income.date.slice(8, 10)) : 1))
  });
  const amount = moneyInput({ value: current ? current.amount : null });
  const hint = h('div', { class: 'field-hint' });

  // The amount follows the suggestion until it is typed over.
  let suggested = null;
  const suggest = () => {
    const d = Math.min(31, Math.max(1, Math.round(Number(day.value)) || 1));
    const s = suggestedContribution(store.data, goal, today, d, current ? current.id : null);
    if (s.amount === null) hint.textContent = t('goal-contribution-no-deadline');
    else if (s.need === 0) hint.textContent = t('goal-contribution-covered');
    else if (!s.count) hint.textContent = t('goal-contribution-too-late');
    else hint.textContent = t('goal-contribution-hint', { date: formatDate(goal.deadline, lang()), amount: money(s.amount), n: s.count });
    if (!current && s.amount !== null && (amount.value === '' || amount.readCents() === suggested)) {
      amount.value = s.amount > 0 && s.count ? centsToInput(s.amount, lang()) : '';
    }
    suggested = s.amount;
  };
  day.addEventListener('input', suggest);
  suggest();

  const actions = [];
  if (current) {
    actions.push({ label: t('goal-contribution-remove'), kind: 'danger', onClick: (m) => { removeContribution(current); m.close(); return true; } });
  }
  actions.push({ label: t('cancel'), onClick: (m) => m.close() });
  actions.push({
    label: t('save'), kind: 'primary', onClick: (m) => {
      const cents = amount.readCents();
      const d = Number(day.value);
      if (!from.value) { showToast(t('err-account'), { type: 'error' }); return false; }
      if (!Number.isInteger(d) || d < 1 || d > 31) { showToast(t('goal-contribution-err-day'), { type: 'error' }); return false; }
      if (cents === null || cents <= 0) { showToast(t('err-amount'), { type: 'error' }); return false; }
      if (current) {
        store.saveTemplate({ ...current, amount: cents, accountId: from.value, schedule: { ...current.schedule, day: d } },
          { applyToFuture: true, scheduleChanged: current.schedule.day !== d });
        showToast(t('toast-contribution-saved'), { type: 'success' });
      } else {
        store.saveTemplate(makeTemplate({
          title: contributionTitle(goal.name),
          type: 'transfer',
          amount: cents,
          accountId: from.value,
          toAccountId: goal.accountId,
          goalId: goal.id,
          schedule: { freq: 'monthly', day: d, startDate: today, endDate: goal.deadline || null }
        }), { applyToFuture: false });
        showToast(t('toast-contribution-added'), { type: 'success' });
      }
      m.close();
      return true;
    }
  });

  openModal({
    title: current ? t('goal-contribution-edit') : t('goal-contribution-new'),
    body: h('div', { class: 'form-stack' },
      h('p', { class: 'field-hint' }, t('goal-contribution-info', { name: goal.name })),
      field(t('goal-contribution-from'), from),
      h('div', { class: 'form-row' }, field(t('goal-contribution-day'), day), field(t('goal-contribution-amount'), amount)),
      hint),
    actions
  });
}

function toggleArchive(goal) {
  const c = goalContribution(store.data, goal);
  if (!goal.archived && c) {
    withUndo(t('toast-goal-archived-contribution'), () => {
      store.update('goals', goal.id, { archived: true });
      store.removeTemplate(c.id, { removeFuture: true });
    });
    return;
  }
  store.update('goals', goal.id, { archived: !goal.archived });
}

function contributionBlock(goal, o, today) {
  const c = o.contribution;
  const raised = raisedContribution(o);
  const late = goal.deadline && goal.deadline < today;
  const buttons = [];
  if (raised !== null) {
    buttons.push(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => withUndo(t('toast-contribution-saved'), () => store.saveTemplate({ ...c, amount: raised }, { applyToFuture: true })) },
      icon('trending-up'), t('goal-contribution-raise', { amount: money(raised) })));
  }
  if (!c && !goal.archived && !o.reached && !late) {
    buttons.push(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => openContributionModal(goal) },
      icon('repeat'), t('goal-contribution-add')));
  }
  return [
    c ? h('div', { class: 'goal-contribution' },
      icon('repeat'),
      h('div', { class: 'goal-contribution-text' },
        h('div', {}, t('goal-contribution', { amount: money(c.amount), when: describeSchedule(c.schedule) })),
        h('div', { class: 'goal-meta' }, `${accountLabel(c.accountId)} → ${accountLabel(c.toAccountId)}`)),
      h('div', { class: 'goal-actions' },
        h('button', { type: 'button', class: 'icon-btn', title: t('goal-contribution-edit'), onclick: () => openContributionModal(goal) }, icon('pencil')),
        h('button', { type: 'button', class: 'icon-btn', title: t('goal-contribution-remove'), onclick: () => removeContribution(c) }, icon('trash-2')))) : null,
    buttons.length ? h('div', { class: 'goal-buttons' }, buttons) : null
  ];
}

function goalCard(goal, today) {
  const p = goalOutlook(store.data, goal, today);
  let plan = null;
  if (p.reached) plan = h('div', { class: 'goal-plan is-reached' }, icon('check-circle-2'), t('goal-reached'));
  else if (p.late) plan = h('div', { class: 'goal-plan is-late' }, icon('alert-triangle'), t('goal-late', { amount: money(p.remaining) }));
  // With a contribution in the plan, the outlook below says the same better.
  else if (p.perMonth !== null && !p.contribution) plan = h('div', { class: 'goal-plan' }, icon('calendar'), t('goal-per-month', { amount: money(p.perMonth), n: p.monthsLeft }));
  // What the plan brings by the deadline, contributions and everything else
  // that moves money on or off the envelope.
  let outlook = null;
  if (!goal.archived && !p.reached && p.projected !== null && goal.deadline >= today) {
    const date = formatDate(goal.deadline, lang());
    outlook = p.shortfall > 0
      ? h('div', { class: 'goal-plan is-late' }, icon('alert-triangle'), t('goal-outlook-short', { date, amount: money(p.projected), short: money(p.shortfall) }))
      : h('div', { class: 'goal-plan is-reached' }, icon('check-circle-2'), t('goal-outlook-ok', { date, amount: money(p.projected) }));
  }
  return h('div', { class: `card goal-card ${goal.archived ? 'is-archived' : ''}`, ondblclick: () => openGoalModal(goal) },
    h('div', { class: 'goal-head' },
      h('div', {},
        h('h3', { class: 'goal-name' }, goal.name, goal.archived ? badge(t('archived'), 'badge-muted') : null),
        h('div', { class: 'goal-meta' }, [accountLabel(goal.accountId), goal.deadline ? t('goal-by', { date: formatDate(goal.deadline, lang()) }) : null].filter(Boolean).join(' · '))),
      h('div', { class: 'goal-actions' },
        h('button', {
          type: 'button', class: 'icon-btn', title: goal.archived ? t('goal-unarchive') : t('goal-archive'),
          onclick: () => toggleArchive(goal)
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
    plan,
    outlook,
    contributionBlock(goal, p, today));
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
