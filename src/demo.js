// Demo household for screenshots, first look and manual testing. Fully made
// up: names, amounts and accounts are invented. Deterministic (seeded), so
// two runs on the same day produce the same budget.

import { emptyData, defaultCategories, DEFAULT_CATEGORIES, makeAccount, makeAsset, makeDebt, makeEntry, makeGoal, makeRule, makeScenario, makeTag, makeTemplate, nowIso } from './model.js';
import { addMonthsToMonth, firstDayOfMonth, monthOf, addDays, dayInMonth, lastDayOfMonth } from './dates.js';
import { pendingGeneration, generationHorizon } from './schedule.js';
import { categorySpentInMonth } from './ledger.js';
import { textsIn } from './i18n/dictionaries.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildDemo(today, lang = 'en') {
  // Every name comes from the interface texts of `lang` (demo-* keys),
  // English while that language is not loaded.
  const L = textsIn(lang);
  const data = emptyData();
  const rand = rng(20261005);
  const month = monthOf(today);
  const start = firstDayOfMonth(addMonthsToMonth(month, -5));

  data.settings = {
    ...data.settings, language: lang, trackingStart: start, onboarded: true,
    currency: 'EUR', updatedAt: nowIso()
  };
  data.categories = defaultCategories(lang);
  // A default category by its key ('groceries'): the list comes in the order of the keys.
  const categoryKeys = Object.values(DEFAULT_CATEGORIES).flat();
  const cat = (key) => data.categories[categoryKeys.indexOf(key)]?.id || null;

  const main = makeAccount({ name: L('demo-account-main'), bank: L('demo-bank'), openingBalance: 185000, order: 0 });
  const bills = makeAccount({ name: L('demo-account-bills'), parentId: main.id, order: 1 });
  const food = makeAccount({ name: L('demo-account-groceries'), parentId: main.id, order: 2 });
  const holiday = makeAccount({ name: L('demo-account-holiday'), parentId: main.id, kind: 'savings', openingBalance: 40000, order: 3 });
  const cash = makeAccount({ name: L('demo-account-cash'), kind: 'cash', openingBalance: 6000, order: 4 });
  const carFund = makeAccount({ name: L('demo-car-insurance'), parentId: main.id, kind: 'savings', openingBalance: 36000, order: 5 });
  data.accounts.push(main, bills, food, holiday, cash, carFund);
  data.settings.defaultIncomeAccountId = main.id;

  const tpl = (f) => { const x = makeTemplate({ ...f, schedule: { startDate: start, ...f.schedule } }); data.templates.push(x); return x; };
  tpl({ title: L('demo-salary'), type: 'income', amount: 265000, accountId: main.id, categoryId: cat('salary'), schedule: { freq: 'monthly', day: 5 } });
  tpl({ title: L('demo-freelance'), type: 'income', amount: 40000, amountIsEstimate: true, accountId: main.id, categoryId: cat('side-income'), schedule: { freq: 'monthly', day: 20 } });
  tpl({ title: L('demo-rent'), amount: 95000, accountId: bills.id, categoryId: cat('housing'), schedule: { freq: 'monthly', day: 1 } });
  tpl({ title: L('demo-energy'), amount: 11500, amountIsEstimate: true, accountId: bills.id, categoryId: cat('housing'), schedule: { freq: 'monthly', day: 15 } });
  tpl({ title: L('demo-water'), amount: 6000, accountId: bills.id, categoryId: cat('housing'), schedule: { freq: 'everyNMonths', interval: 2, day: 12 } });
  tpl({ title: L('demo-phone'), amount: 2500, accountId: bills.id, categoryId: cat('phone'), schedule: { freq: 'monthly', day: 18 } });
  tpl({ title: L('demo-streaming'), amount: 1299, accountId: bills.id, categoryId: cat('phone'), schedule: { freq: 'monthly', day: 22 } });
  const carLoan = tpl({ title: L('demo-car-loan'), amount: 28000, accountId: bills.id, categoryId: cat('loans'), schedule: { freq: 'monthly', day: 10 } });
  tpl({ title: L('demo-kindergarten'), amount: 18000, accountId: bills.id, categoryId: cat('kids'), schedule: { freq: 'monthly', day: 6 } });
  tpl({ title: L('demo-groceries-first'), amount: 25000, accountId: food.id, categoryId: cat('groceries'), schedule: { freq: 'monthly', day: 6 } });
  tpl({ title: L('demo-groceries-second'), amount: 25000, accountId: food.id, categoryId: cat('groceries'), schedule: { freq: 'monthly', day: 21 } });
  const holidaySaving = tpl({ title: L('demo-holiday-saving'), type: 'transfer', amount: 15000, accountId: main.id, toAccountId: holiday.id, schedule: { freq: 'monthly', day: 6 } });
  const insurance = tpl({ title: L('demo-car-insurance'), amount: 42000, accountId: carFund.id, categoryId: cat('car'), schedule: { freq: 'yearly', day: 14, startDate: `${month.slice(0, 4)}-${addMonthsToMonth(month, 1).slice(5, 7)}-14` } });
  tpl({ title: L('demo-cloud-storage'), amount: 3000, accountId: bills.id, categoryId: cat('phone'), schedule: { freq: 'yearly', day: 2, startDate: `${addMonthsToMonth(month, 2)}-02` } });
  const insuranceSaving = tpl({ title: L('goal-contribution-title', { name: L('demo-car-insurance') }), type: 'transfer', amount: 6000, accountId: main.id, toAccountId: carFund.id, schedule: { freq: 'monthly', day: 6, startDate: today, endDate: insurance.schedule.startDate } });

  // The holiday envelope saves for a summer trip; its monthly transfer is the
  // goal's contribution.
  const tripYear = Number(month.slice(0, 4)) + (Number(month.slice(5, 7)) >= 6 ? 1 : 0);
  const trip = makeGoal({ name: L('demo-holiday-goal'), targetAmount: 240000, accountId: holiday.id, deadline: `${tripYear}-07-01` });
  data.goals.push(trip);
  holidaySaving.goalId = trip.id;

  // The car insurance comes once a year: its envelope saves ahead for it and
  // the payment is paid from there.
  const insuranceGoal = makeGoal({
    name: insurance.title, targetAmount: insurance.amount, accountId: carFund.id,
    deadline: insurance.schedule.startDate, templateId: insurance.id, templateAccountId: main.id
  });
  data.goals.push(insuranceGoal);
  insuranceSaving.goalId = insuranceGoal.id;

  const horizon = generationHorizon(today, 3);
  const generated = pendingGeneration(data, today, horizon);
  data.entries.push(...generated.entries);
  generated.marks.forEach(m => { data.templates.find(x => x.id === m.id).generatedThrough = m.generatedThrough; });

  // Past rows (and today's) happened, with real amounts drifting from the
  // plan a little.
  data.entries.forEach(e => {
    if (e.date > today) return;
    const template = data.templates.find(x => x.id === e.templateId);
    if (template && template.amountIsEstimate) e.amount = Math.round(e.plannedAmount * (0.85 + rand() * 0.3));
    // The streaming service raised its price two months ago.
    if (template && template.title === L('demo-streaming') && e.date < firstDayOfMonth(addMonthsToMonth(month, -2))) {
      e.amount = 999;
      e.plannedAmount = 999;
    }
    e.status = 'done';
    e.doneAt = nowIso();
  });

  // Small everyday spending, a few per week.
  const quick = [
    [L('demo-coffee'), 'eating-out', 250, 600],
    [L('demo-lunch'), 'eating-out', 800, 1600],
    [L('demo-pharmacy'), 'health', 600, 3500],
    [L('demo-cinema'), 'entertainment', 1200, 2600],
    [L('demo-fuel'), 'car', 4000, 7000],
    [L('demo-bakery'), 'groceries', 300, 900]
  ];
  for (let d = start; d < today; d = addDays(d, 1)) {
    if (rand() > 0.45) continue;
    const [title, catKey, lo, hi] = quick[Math.floor(rand() * quick.length)];
    data.entries.push(makeEntry({
      date: d, title, type: 'expense', amount: Math.round(lo + rand() * (hi - lo)),
      accountId: catKey === 'groceries' ? food.id : main.id,
      categoryId: cat(catKey), status: 'done', doneAt: nowIso(), isQuick: true
    }));
  }

  // A weekend trip under way: a tag with a budget and dates, a few payments
  // already made (one receipt split over two categories) and the train back
  // still planned.
  const weekend = makeTag({ name: L('demo-trip'), color: 'teal', budget: 60000, startDate: addDays(today, -1), endDate: addDays(today, 1) });
  data.tags.push(weekend);
  const tripEntry = (f) => makeEntry({ type: 'expense', accountId: main.id, status: 'done', doneAt: nowIso(), tagIds: [weekend.id], ...f });
  data.entries.push(
    tripEntry({ date: addDays(today, -6), title: L('demo-trip-train'), amount: 3890, categoryId: cat('travel') }),
    tripEntry({ date: addDays(today, -1), title: L('demo-trip-hotel'), amount: 21400, categoryId: cat('travel') }),
    tripEntry({
      date: addDays(today, -1), title: L('demo-trip-dinner'), amount: 9650, categoryId: cat('eating-out'),
      splits: [
        { categoryId: cat('eating-out'), amount: 5850, note: '' },
        { categoryId: cat('entertainment'), amount: 3800, note: L('demo-trip-tickets') }
      ]
    }),
    tripEntry({ date: today, title: L('demo-trip-museum'), amount: 1800, categoryId: cat('entertainment'), isQuick: true }),
    tripEntry({ date: addDays(today, 1), title: L('demo-trip-back'), amount: 3890, categoryId: cat('travel'), status: 'planned', doneAt: null }));

  // A supermarket receipt split over groceries, the kids and the pharmacy
  // shelf: one payment on the account, three categories in the figures.
  const receiptParts = [
    { categoryId: cat('groceries'), amount: 4230, note: '' },
    { categoryId: cat('kids'), amount: 890, note: L('demo-crayons') },
    { categoryId: cat('health'), amount: 650, note: L('demo-vitamins') }
  ];
  data.entries.push(makeEntry({
    date: addDays(today, -3), title: L('demo-supermarket'), type: 'expense', amount: 5770, accountId: food.id,
    categoryId: receiptParts[0].categoryId, splits: receiptParts, status: 'done', doneAt: nowIso(), isQuick: true
  }));

  // Eating out has a monthly limit and is close to it this month, so the
  // alerts have something to show; entertainment has room left.
  const limited = (catKey, share) => {
    const c = data.categories.find(x => x.id === cat(catKey));
    // Counted the way the alerts count it: parts of split payments apart.
    const spent = categorySpentInMonth(data, c.id, month);
    c.monthlyLimit = spent > 0 ? Math.ceil(spent / share / 100) * 100 : 5000;
  };
  limited('eating-out', 0.85);
  limited('entertainment', 0.4);

  // Every payday the money for bills and groceries moves to its envelope and
  // the month's bills count as covered, exactly the routine the app is for.
  for (let m = monthOf(start); m <= month; m = addMonthsToMonth(m, 1)) {
    const payday = dayInMonth(m, 5);
    if (payday > today) break;
    [bills, food].forEach(env => {
      const monthBills = data.entries.filter(e => e.accountId === env.id && e.type === 'expense' && !e.isQuick
        && e.date >= firstDayOfMonth(m) && e.date <= lastDayOfMonth(m));
      const sum = monthBills.reduce((s, e) => s + e.plannedAmount, 0);
      if (!sum) return;
      data.entries.push(makeEntry({
        date: payday, title: L('demo-salary-split'), type: 'transfer', amount: sum,
        accountId: main.id, toAccountId: env.id, status: 'done', doneAt: nowIso(), allocationId: `demo-${m}`
      }));
      monthBills.forEach(e => {
        e.allocationId = `demo-${m}`;
        if (e.status === 'planned') { e.status = 'reserved'; e.reservedAt = nowIso(); }
      });
    });
  }

  // Category rules for the quick entry and the statement import, the way a
  // bank writes the shops.
  const shop = (key) => L(key).toLocaleLowerCase();
  [
    { text: shop('demo-shop-groceries'), title: L('demo-shop-groceries'), categoryId: cat('groceries'), accountId: food.id },
    { text: shop('demo-shop-coffee'), title: L('demo-shop-coffee'), categoryId: cat('eating-out') },
    { text: shop('demo-shop-fuel'), title: L('demo-shop-fuel'), categoryId: cat('car') },
    { text: shop('demo-shop-gym'), type: 'expense', categoryId: cat('health') }
  ].forEach((r, i) => data.rules.push(makeRule({ type: 'expense', ...r, order: i + 1 })));

  // The car loan: the bank's statement said 8 800 left when tracking began,
  // the recurring payment pays it since. A friend pays back a small loan in
  // parts.
  const car = makeDebt({
    name: L('demo-car-loan'), lender: L('demo-bank'), original: 1200000, balance: 880000,
    balanceDate: start, rate: 5.9, payment: carLoan.amount, paymentDay: carLoan.schedule.day,
    accountId: bills.id, categoryId: carLoan.categoryId, templateId: carLoan.id
  });
  carLoan.debtId = car.id;
  const lentFrom = firstDayOfMonth(addMonthsToMonth(month, -2));
  const lent = makeDebt({
    name: L('demo-friend-loan'), kind: 'owed', lender: L('demo-friend'), original: 40000,
    balanceDate: lentFrom, payment: 10000, paymentDay: 25, accountId: main.id, categoryId: cat('other-income')
  });
  data.debts.push(car, lent);

  // A what-if draft to try on the forecast; off until switched on.
  data.scenarios.push(makeScenario({
    title: L('demo-laptop'), amount: 120000, date: dayInMonth(addMonthsToMonth(month, 2), 12),
    accountId: main.id, categoryId: cat('other'), active: false
  }));
  const backOn = dayInMonth(addMonthsToMonth(month, -1), 25);
  if (backOn <= today) {
    data.entries.push(makeEntry({
      date: backOn, title: L('demo-friend-paid'), type: 'income', amount: 10000,
      accountId: main.id, categoryId: lent.categoryId, debtId: lent.id, status: 'done', doneAt: nowIso()
    }));
  }
  // Property and investments for net worth: the car the loan paid for,
  // losing a little value, and a small index fund that grows.
  data.assets.push(makeAsset({
    name: L('demo-family-car'), kind: 'vehicle', values: [
      { date: start, amount: 1450000 },
      { date: firstDayOfMonth(addMonthsToMonth(month, -2)), amount: 1390000 }
    ]
  }));
  data.assets.push(makeAsset({
    name: L('demo-index-fund'), kind: 'investment', note: L('demo-brokerage'), values: [
      { date: start, amount: 320000 },
      { date: firstDayOfMonth(addMonthsToMonth(month, -3)), amount: 336000 },
      { date: firstDayOfMonth(addMonthsToMonth(month, -1)), amount: 351500 }
    ]
  }));
  return data;
}
