// Debts: loans I pay off and money someone owes me. Each card shows what is
// left, how much is paid as a bar, and when it ends at the current payment.
// A debt can be paid by a recurring payment (linked by templateId on the
// debt and debtId on the template). The planner below works out the order
// to pay several loans off with some extra money each month.

import { store } from '../store.js';
import { t, tn } from '../i18n.js';
import { decimalOf, localeOf } from '../i18n/languages.js';
import { h, clear, icon, money, refreshIcons, lang, emptyState, field, moneyInput, selectEl, accountOptions, categoryOptions, openModal, accountLabel, badge } from '../ui.js';
import { debtOutlook, nextPaymentMonth, payoffPlan, planDebts } from '../debts.js';
import { firstDayOfMonth, formatDate, formatMonth, formatMonthInText, isDayKey, monthOf, todayKey } from '../dates.js';
import { live, makeDebt, makeTemplate } from '../model.js';
import { showToast } from '../toast.js';
import { segmented, withUndo } from '../modals.js';

let showArchived = false;
let plannerExtra = 10000;
let plannerStrategy = 'avalanche';

const paymentType = (debt) => (debt.kind === 'owed' ? 'income' : 'expense');

function parseRate(value) {
  const n = Number(String(value || '').replace(',', '.').replace('%', '').trim());
  return Number.isFinite(n) && n >= 0 && n < 1000 ? n : null;
}

function rateText(rate) {
  return `${(Number(rate) || 0).toLocaleString(localeOf(lang()), { maximumFractionDigits: 2 })}%`;
}

// Recurring payments a debt can be linked to: of the matching type, not
// already paying another debt.
function templateOptions(debt, kind) {
  const type = kind === 'owed' ? 'income' : 'expense';
  const taken = new Set(live(store.data.debts).filter(d => !debt || d.id !== debt.id).map(d => d.templateId).filter(Boolean));
  return [{ value: '', label: t('debt-no-template') }].concat(live(store.data.templates)
    .filter(x => x.type === type && x.active !== false && !x.goalId && !taken.has(x.id))
    .sort((a, b) => a.title.localeCompare(b.title, lang()))
    .map(x => ({ value: x.id, label: `${x.title}, ${money(x.amount)}` })));
}

// Moves the link of a recurring payment from one template to another.
function relinkTemplate(debtId, fromId, toId) {
  if (fromId === toId) return;
  if (fromId && store.find('templates', fromId)) store.update('templates', fromId, { debtId: null });
  if (toId && store.find('templates', toId)) store.update('templates', toId, { debtId });
}

export function openDebtModal(debt = null) {
  const isNew = !debt;
  const src = debt || { kind: 'owe', paymentDay: Number(todayKey().slice(8, 10)) };
  let kind = src.kind || 'owe';
  const name = h('input', { type: 'text', value: src.name || '', placeholder: t('debt-name-placeholder') });
  const lender = h('input', { type: 'text', value: src.lender || '' });
  const original = moneyInput({ value: src.original || null });
  const remaining = moneyInput({ value: null, placeholder: t('debt-remaining-placeholder') });
  const rate = h('input', { type: 'text', inputmode: 'decimal', value: src.rate ? String(src.rate).replace('.', decimalOf(lang())) : '', placeholder: '0' });
  const payment = moneyInput({ value: src.payment || null });
  const day = h('input', { type: 'number', min: '1', max: '31', step: '1', value: String(src.paymentDay || 1) });
  const account = selectEl(accountOptions({ emptyLabel: t('choose-account') }), src.accountId || '');
  const category = h('select');
  const template = h('select');
  const note = h('textarea', { rows: 2, placeholder: t('note-placeholder') }, src.note || '');

  const lenderField = field(t('debt-lender'), lender);
  const accountField = field(t('debt-account'), account);
  const templateField = field(t('debt-template'), template, t('debt-template-hint'));

  function syncKind() {
    lenderField.querySelector('label').textContent = kind === 'owed' ? t('debt-person') : t('debt-lender');
    accountField.querySelector('label').textContent = kind === 'owed' ? t('debt-account-owed') : t('debt-account');
    clear(category);
    const catId = src.kind === kind ? src.categoryId : null;
    categoryOptions(paymentType({ kind }), { emptyLabel: t('no-category') })
      .forEach(o => category.appendChild(h('option', { value: o.value, selected: o.value === (catId || '') }, o.label)));
    clear(template);
    const tplId = src.kind === kind ? src.templateId : null;
    templateOptions(debt, kind).forEach(o => template.appendChild(h('option', { value: o.value, selected: o.value === (tplId || '') }, o.label)));
  }

  const kindSwitch = segmented([
    { value: 'owe', label: t('debt-kind-owe') },
    { value: 'owed', label: t('debt-kind-owed') }
  ], kind, (v) => { kind = v; syncKind(); });

  const actions = [];
  if (!isNew) {
    actions.push({
      label: t('delete'), kind: 'danger', onClick: (m) => {
        withUndo(t('toast-debt-deleted'), () => {
          relinkTemplate(debt.id, debt.templateId, null);
          store.remove('debts', debt.id);
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
      const total = original.readCents();
      if (total === null || total <= 0) { showToast(t('err-amount'), { type: 'error' }); return false; }
      const left = remaining.value.trim() ? remaining.readCents() : total;
      if (left === null || left < 0) { showToast(t('err-amount'), { type: 'error' }); return false; }
      const r = parseRate(rate.value);
      if (r === null) { showToast(t('debt-err-rate'), { type: 'error' }); return false; }
      const pay = payment.value.trim() ? payment.readCents() : 0;
      if (pay === null || pay < 0) { showToast(t('err-amount'), { type: 'error' }); return false; }
      const d = Number(day.value);
      if (!Number.isInteger(d) || d < 1 || d > 31) { showToast(t('goal-contribution-err-day'), { type: 'error' }); return false; }
      const patch = {
        name: name.value.trim(), kind, lender: lender.value.trim(), original: total, rate: r, payment: pay, paymentDay: d,
        accountId: account.value || null, categoryId: category.value || null, templateId: template.value || null, note: note.value.trim()
      };
      if (isNew) {
        const created = makeDebt({ ...patch, balance: left, balanceDate: todayKey() });
        store.add('debts', created);
        relinkTemplate(created.id, null, created.templateId);
      } else {
        relinkTemplate(debt.id, debt.templateId, patch.templateId);
        store.update('debts', debt.id, patch);
      }
      m.close();
      return true;
    }
  });

  syncKind();
  openModal({
    title: isNew ? t('debt-new') : t('debt-edit'),
    body: h('div', { class: 'form-stack' },
      kindSwitch,
      h('div', { class: 'form-row' }, field(t('field-name'), name), lenderField),
      h('div', { class: 'form-row' },
        field(t('debt-original'), original),
        isNew ? field(t('debt-remaining'), remaining, t('debt-remaining-hint')) : null),
      h('div', { class: 'form-row' }, field(t('debt-rate'), rate, t('debt-rate-hint')), field(t('debt-payment'), payment), field(t('debt-day'), day)),
      h('div', { class: 'form-row' }, accountField, field(t('field-category'), category)),
      templateField,
      field(t('field-note'), note)),
    actions
  });
  setTimeout(() => name.focus(), 50);
}

// A new checkpoint: the remaining amount as the bank shows it on a day.
// Payments after that day bring it down from there.
export function openBalanceModal(debt) {
  const o = debtOutlook(store.data, debt, todayKey());
  const amount = moneyInput({ value: o.remaining, autofocus: true });
  const date = h('input', { type: 'date', value: todayKey() });
  openModal({
    title: t('debt-update-balance'),
    body: h('div', { class: 'form-stack' },
      h('p', { class: 'field-hint' }, t('debt-balance-info', { name: debt.name })),
      h('div', { class: 'form-row' }, field(t('debt-remaining'), amount), field(t('debt-balance-date'), date))),
    actions: [
      { label: t('cancel'), onClick: (m) => m.close() },
      {
        label: t('save'), kind: 'primary', onClick: (m) => {
          const cents = amount.readCents();
          if (cents === null || cents < 0) { showToast(t('err-amount'), { type: 'error' }); return false; }
          if (!isDayKey(date.value)) { showToast(t('err-date'), { type: 'error' }); return false; }
          withUndo(t('toast-debt-balance'), () => store.update('debts', debt.id, { balance: cents, balanceDate: date.value }));
          m.close();
          return true;
        }
      }
    ]
  });
}

// The monthly payment as a recurring payment in the plan, from the debt's
// account on its payment day. When this month is paid already, it starts
// next month so the month does not get a second payment.
export function makeRecurring(debt) {
  if (!debt.accountId || !(debt.payment > 0)) {
    showToast(t('debt-recurring-need'), { type: 'error' });
    openDebtModal(debt);
    return;
  }
  const today = todayKey();
  const o = debtOutlook(store.data, debt, today);
  const startMonth = nextPaymentMonth(o, today);
  const tpl = makeTemplate({
    title: debt.name,
    type: paymentType(debt),
    amount: debt.payment,
    accountId: debt.accountId,
    categoryId: debt.categoryId,
    debtId: debt.id,
    schedule: { freq: 'monthly', day: debt.paymentDay || 1, startDate: startMonth === monthOf(today) ? today : firstDayOfMonth(startMonth) }
  });
  withUndo(t('toast-debt-recurring'), () => {
    store.saveTemplate(tpl, { applyToFuture: false });
    store.update('debts', debt.id, { templateId: tpl.id });
  });
}

function toggleArchive(debt) {
  withUndo(debt.archived ? t('toast-debt-restored') : t('toast-debt-archived'), () => store.update('debts', debt.id, { archived: !debt.archived }));
}

// The bar and the line under it, shared with the phone.
export function debtBar(debt, o) {
  const owed = debt.kind === 'owed';
  return [
    h('div', { class: `goal-bar debt-bar ${owed ? 'is-owed' : ''}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(o.percent), 'aria-label': t(owed ? 'debt-percent-owed' : 'debt-percent', { n: o.percent }) },
      h('div', { class: 'goal-bar-fill', style: `width: ${o.percent}%` })),
    h('div', { class: 'goal-foot debt-foot' },
      h('span', { class: 'debt-percent' }, t(owed ? 'debt-percent-owed' : 'debt-percent', { n: o.percent })),
      h('span', { class: 'muted' }, t(owed ? 'debt-paid-of-owed' : 'debt-paid-of', { paid: money(o.principalPaid), total: money(o.original) })))
  ];
}

function payoffLine(debt, o) {
  if (o.paidOff) return h('div', { class: 'goal-plan is-reached' }, icon('check-circle-2'), t(debt.kind === 'owed' ? 'debt-returned' : 'debt-paid-off'));
  if (!(debt.payment > 0)) return h('div', { class: 'goal-plan' }, icon('info'), t('debt-no-payment'));
  if (o.schedule.never) return h('div', { class: 'goal-plan is-late' }, icon('alert-triangle'), t('debt-never', { amount: money(o.schedule.firstInterest || 0) }));
  return h('div', { class: 'goal-plan' }, icon('calendar'),
    t(debt.kind === 'owed' ? 'debt-payoff-owed' : 'debt-payoff', { month: formatMonthInText(o.schedule.payoffMonth, lang()), n: o.schedule.months }));
}

function recurringBlock(debt) {
  const tpl = debt.templateId ? store.find('templates', debt.templateId) : null;
  if (tpl) {
    return h('div', { class: 'goal-contribution' },
      icon('repeat'),
      h('div', { class: 'goal-contribution-text' },
        h('div', {}, t('debt-paid-by', { name: tpl.title, amount: money(tpl.amount) })),
        h('div', { class: 'goal-meta' }, accountLabel(tpl.accountId))));
  }
  if (debt.archived) return null;
  return h('div', { class: 'goal-buttons' },
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => makeRecurring(debt) }, icon('repeat'), t('debt-make-recurring')),
    templateOptions(debt, debt.kind).length > 1
      ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => openDebtModal(debt) }, icon('link'), t('debt-link-template'))
      : null);
}

function debtCard(debt, today) {
  const o = debtOutlook(store.data, debt, today);
  const owed = debt.kind === 'owed';
  const facts = [
    debt.payment > 0 ? [t(owed ? 'debt-fact-payment-owed' : 'debt-fact-payment'), t('debt-payment-day', { amount: money(debt.payment), day: debt.paymentDay || 1 })] : null,
    [t('debt-fact-rate'), rateText(debt.rate)],
    !o.paidOff && o.schedule.totalInterest > 0 ? [t('debt-fact-interest-left'), money(o.schedule.totalInterest)] : null,
    o.interestPaid > 0 ? [t('debt-fact-interest-paid'), money(o.interestPaid)] : null
  ].filter(Boolean);
  const meta = [debt.lender, accountLabel(debt.accountId)].filter(Boolean).join(' · ');
  return h('div', { class: `card goal-card debt-card ${debt.archived ? 'is-archived' : ''}`, ondblclick: () => openDebtModal(debt) },
    h('div', { class: 'goal-head' },
      h('div', { class: 'debt-title' },
        h('h3', { class: 'goal-name' }, h('span', { class: 'debt-name-text' }, debt.name),
          owed ? badge(t('debt-kind-owed-badge'), 'badge-main') : null,
          debt.archived ? badge(t('archived'), 'badge-muted') : null),
        meta ? h('div', { class: 'goal-meta' }, meta) : null),
      h('div', { class: 'goal-actions' },
        h('button', { type: 'button', class: 'icon-btn', title: t('debt-update-balance'), 'aria-label': t('debt-update-balance'), onclick: () => openBalanceModal(debt) }, icon('refresh-cw')),
        h('button', { type: 'button', class: 'icon-btn', title: debt.archived ? t('goal-unarchive') : t('goal-archive'), 'aria-label': debt.archived ? t('goal-unarchive') : t('goal-archive'), onclick: () => toggleArchive(debt) }, icon(debt.archived ? 'archive-restore' : 'archive')),
        h('button', { type: 'button', class: 'icon-btn', title: t('edit'), 'aria-label': t('edit'), onclick: () => openDebtModal(debt) }, icon('pencil')))),
    h('div', { class: 'goal-numbers' },
      h('span', { class: 'goal-saved money' }, money(o.remaining)),
      h('span', { class: 'goal-target' }, t(owed ? 'debt-left-owed' : 'debt-left'))),
    debtBar(debt, o),
    h('dl', { class: 'debt-facts' }, facts.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', { class: 'money' }, v)))),
    payoffLine(debt, o),
    debt.balanceDate ? h('div', { class: 'goal-meta' }, t('debt-checkpoint', { amount: money(debt.balance), date: formatDate(debt.balanceDate, lang()) })) : null,
    recurringBlock(debt));
}

function plannerResult(plan) {
  if (plan.never) {
    return h('div', { class: 'goal-plan is-late' }, icon('alert-triangle'), t('planner-never'));
  }
  const rows = plan.order.map((d, i) => h('tr', {},
    h('td', { class: 'num' }, String(i + 1)),
    h('td', {}, d.name),
    h('td', { class: 'num' }, rateText(d.rate)),
    h('td', { class: 'num money' }, money(d.balance)),
    h('td', {}, d.payoffMonth ? formatMonth(d.payoffMonth, lang()) : ''),
    h('td', { class: 'num money' }, money(d.interest))));
  const saved = plan.baseline.never
    ? t('planner-saved-never')
    : plan.monthsSaved > 0 || plan.interestSaved > 0
      ? `${tn('planner-saved-months', plan.monthsSaved)}, ${t('planner-saved-interest', { amount: money(plan.interestSaved) })}`
      : t('planner-saved-none');
  return [
    h('div', { class: 'table-scroll' }, h('table', { class: 'an-table planner-table' },
      h('thead', {}, h('tr', {},
        h('th', { class: 'num' }, '#'),
        h('th', {}, t('planner-col-debt')),
        h('th', { class: 'num' }, t('planner-col-rate')),
        h('th', { class: 'num' }, t('planner-col-left')),
        h('th', {}, t('planner-col-payoff')),
        h('th', { class: 'num' }, t('planner-col-interest')))),
      h('tbody', {}, rows))),
    h('div', { class: 'planner-summary' },
      h('div', { class: 'goal-plan' }, icon('calendar'), t('planner-total', { month: formatMonthInText(plan.payoffMonth, lang()), amount: money(plan.totalInterest), budget: money(plan.budget) })),
      h('div', { class: 'goal-plan is-reached' }, icon('trending-up'), saved))
  ];
}

function plannerCard(today) {
  const debts = planDebts(store.data, today);
  if (!debts.length) return null;
  // The plan starts with the earliest payment still to come, the same month
  // the cards count from.
  const startMonth = live(store.data.debts).filter(d => debts.some(x => x.id === d.id))
    .map(d => nextPaymentMonth(debtOutlook(store.data, d, today), today)).sort()[0];
  const result = h('div', { class: 'planner-result' });
  const draw = () => {
    clear(result);
    const plan = payoffPlan(debts, plannerExtra, plannerStrategy, startMonth);
    [plannerResult(plan)].flat().forEach(el => result.appendChild(el));
    refreshIcons();
  };
  const extra = moneyInput({ value: plannerExtra });
  extra.addEventListener('input', () => {
    const v = extra.value.trim() ? extra.readCents() : 0;
    if (v === null || v < 0) return;
    plannerExtra = v;
    draw();
  });
  const strategy = segmented([
    { value: 'avalanche', label: t('planner-avalanche') },
    { value: 'snowball', label: t('planner-snowball') }
  ], plannerStrategy, (v) => { plannerStrategy = v; draw(); });
  draw();
  return h('div', { class: 'card planner-card' },
    h('div', { class: 'card-title-row' }, icon('calculator'), h('h3', {}, t('planner-title'))),
    h('p', { class: 'field-hint' }, t('planner-intro')),
    h('div', { class: 'planner-controls' },
      field(t('planner-extra'), extra),
      field(t('planner-strategy'), strategy, t(plannerStrategy === 'snowball' ? 'planner-snowball-hint' : 'planner-avalanche-hint'))),
    result);
}

export function renderDebts(root) {
  clear(root);
  const today = todayKey();
  const debts = live(store.data.debts || []);
  const visible = debts.filter(d => showArchived || !d.archived)
    .sort((a, b) => (a.archived - b.archived) || ((a.kind === 'owed') - (b.kind === 'owed')) || a.name.localeCompare(b.name, lang()));
  const archivedCount = debts.filter(d => d.archived).length;

  root.appendChild(h('div', { class: 'view-header' },
    h('div', {}, h('h1', { class: 'view-title' }, t('nav-debts')), h('p', { class: 'view-subtitle' }, t('debts-subtitle'))),
    h('div', { class: 'header-actions' },
      archivedCount ? h('label', { class: 'checkbox-row' },
        h('input', { type: 'checkbox', checked: showArchived, onchange: (e) => { showArchived = e.target.checked; renderDebts(root); } }),
        h('span', {}, t('goals-show-archived', { n: archivedCount }))) : null,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openDebtModal() }, icon('plus'), t('debt-new')))));

  if (!visible.length) {
    root.appendChild(h('div', { class: 'card' }, emptyState(t('debts-empty'), 'landmark')));
  } else {
    root.appendChild(h('div', { class: 'goal-grid' }, visible.map(d => debtCard(d, today))));
  }
  const planner = plannerCard(today);
  if (planner) root.appendChild(planner);
  root.appendChild(h('p', { class: 'field-hint' }, t('debts-hint')));
  refreshIcons();
}
