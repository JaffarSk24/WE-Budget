// Demo household for screenshots, first look and manual testing. Fully made
// up: names, amounts and accounts are invented. Deterministic (seeded), so
// two runs on the same day produce the same budget.

import { emptyData, defaultCategories, makeAccount, makeEntry, makeGoal, makeRule, makeTag, makeTemplate, nowIso } from './model.js';
import { addMonthsToMonth, firstDayOfMonth, monthOf, addDays, dayInMonth, lastDayOfMonth } from './dates.js';
import { pendingGeneration, generationHorizon } from './schedule.js';
import { categorySpentInMonth } from './ledger.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildDemo(today, lang = 'en') {
  const ru = lang === 'ru';
  const L = (en, r) => (ru ? r : en);
  const data = emptyData();
  const rand = rng(20261005);
  const month = monthOf(today);
  const start = firstDayOfMonth(addMonthsToMonth(month, -5));

  data.settings = {
    ...data.settings, language: lang, trackingStart: start, onboarded: true,
    currency: 'EUR', updatedAt: nowIso()
  };
  data.categories = defaultCategories(lang);
  const cat = (name) => data.categories.find(c => c.name === name)?.id || null;

  const main = makeAccount({ name: L('Everyday account', 'Основной счёт'), bank: L('City Bank', 'Городской банк'), openingBalance: 185000, order: 0 });
  const bills = makeAccount({ name: L('Bills', 'Счета и подписки'), parentId: main.id, order: 1 });
  const food = makeAccount({ name: L('Groceries', 'Продукты'), parentId: main.id, order: 2 });
  const holiday = makeAccount({ name: L('Holiday', 'Отпуск'), parentId: main.id, kind: 'savings', openingBalance: 40000, order: 3 });
  const cash = makeAccount({ name: L('Cash', 'Наличные'), kind: 'cash', openingBalance: 6000, order: 4 });
  const carFund = makeAccount({ name: L('Car insurance', 'Страховка машины'), parentId: main.id, kind: 'savings', openingBalance: 36000, order: 5 });
  data.accounts.push(main, bills, food, holiday, cash, carFund);
  data.settings.defaultIncomeAccountId = main.id;

  const tpl = (f) => { const x = makeTemplate({ ...f, schedule: { startDate: start, ...f.schedule } }); data.templates.push(x); return x; };
  tpl({ title: L('Salary', 'Зарплата'), type: 'income', amount: 265000, accountId: main.id, categoryId: cat(L('Salary', 'Зарплата')), schedule: { freq: 'monthly', day: 5 } });
  tpl({ title: L('Freelance project', 'Подработка'), type: 'income', amount: 40000, amountIsEstimate: true, accountId: main.id, categoryId: cat(L('Side income', 'Подработка')), schedule: { freq: 'monthly', day: 20 } });
  tpl({ title: L('Rent', 'Аренда квартиры'), amount: 95000, accountId: bills.id, categoryId: cat(L('Housing', 'Жильё')), schedule: { freq: 'monthly', day: 1 } });
  tpl({ title: L('Electricity and gas', 'Электричество и газ'), amount: 11500, amountIsEstimate: true, accountId: bills.id, categoryId: cat(L('Housing', 'Жильё')), schedule: { freq: 'monthly', day: 15 } });
  tpl({ title: L('Water', 'Вода'), amount: 6000, accountId: bills.id, categoryId: cat(L('Housing', 'Жильё')), schedule: { freq: 'everyNMonths', interval: 2, day: 12 } });
  tpl({ title: L('Phone', 'Телефон'), amount: 2500, accountId: bills.id, categoryId: cat(L('Phone and subscriptions', 'Связь и подписки')), schedule: { freq: 'monthly', day: 18 } });
  tpl({ title: L('Streaming', 'Онлайн-кинотеатр'), amount: 1299, accountId: bills.id, categoryId: cat(L('Phone and subscriptions', 'Связь и подписки')), schedule: { freq: 'monthly', day: 22 } });
  tpl({ title: L('Car loan', 'Автокредит'), amount: 28000, accountId: bills.id, categoryId: cat(L('Loans', 'Кредиты')), schedule: { freq: 'monthly', day: 10 } });
  tpl({ title: L('Kindergarten', 'Детский сад'), amount: 18000, accountId: bills.id, categoryId: cat(L('Kids', 'Дети')), schedule: { freq: 'monthly', day: 6 } });
  tpl({ title: L('Groceries, first half', 'Продукты, первая половина'), amount: 25000, accountId: food.id, categoryId: cat(L('Groceries', 'Продукты')), schedule: { freq: 'monthly', day: 6 } });
  tpl({ title: L('Groceries, second half', 'Продукты, вторая половина'), amount: 25000, accountId: food.id, categoryId: cat(L('Groceries', 'Продукты')), schedule: { freq: 'monthly', day: 21 } });
  const holidaySaving = tpl({ title: L('Save for the holiday', 'Откладываем на отпуск'), type: 'transfer', amount: 15000, accountId: main.id, toAccountId: holiday.id, schedule: { freq: 'monthly', day: 6 } });
  const insurance = tpl({ title: L('Car insurance', 'Страховка машины'), amount: 42000, accountId: carFund.id, categoryId: cat(L('Car', 'Авто')), schedule: { freq: 'yearly', day: 14, startDate: `${month.slice(0, 4)}-${addMonthsToMonth(month, 1).slice(5, 7)}-14` } });
  tpl({ title: L('Cloud storage', 'Облачное хранилище'), amount: 3000, accountId: bills.id, categoryId: cat(L('Phone and subscriptions', 'Связь и подписки')), schedule: { freq: 'yearly', day: 2, startDate: `${addMonthsToMonth(month, 2)}-02` } });
  const insuranceSaving = tpl({ title: L('Saving for Car insurance', 'Откладываем: Страховка машины'), type: 'transfer', amount: 6000, accountId: main.id, toAccountId: carFund.id, schedule: { freq: 'monthly', day: 6, startDate: today, endDate: insurance.schedule.startDate } });

  // The holiday envelope saves for a summer trip; its monthly transfer is the
  // goal's contribution.
  const tripYear = Number(month.slice(0, 4)) + (Number(month.slice(5, 7)) >= 6 ? 1 : 0);
  const trip = makeGoal({ name: L('Summer holiday', 'Отпуск на море'), targetAmount: 240000, accountId: holiday.id, deadline: `${tripYear}-07-01` });
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
    if (template && template.title === L('Streaming', 'Онлайн-кинотеатр') && e.date < firstDayOfMonth(addMonthsToMonth(month, -2))) {
      e.amount = 999;
      e.plannedAmount = 999;
    }
    e.status = 'done';
    e.doneAt = nowIso();
  });

  // Small everyday spending, a few per week.
  const quick = [
    [L('Coffee', 'Кофе'), L('Eating out', 'Кафе и рестораны'), 250, 600],
    [L('Lunch', 'Обед'), L('Eating out', 'Кафе и рестораны'), 800, 1600],
    [L('Pharmacy', 'Аптека'), L('Health', 'Здоровье'), 600, 3500],
    [L('Cinema', 'Кино'), L('Entertainment', 'Развлечения'), 1200, 2600],
    [L('Fuel', 'Бензин'), L('Car', 'Авто'), 4000, 7000],
    [L('Bakery', 'Пекарня'), L('Groceries', 'Продукты'), 300, 900]
  ];
  for (let d = start; d < today; d = addDays(d, 1)) {
    if (rand() > 0.45) continue;
    const [title, catName, lo, hi] = quick[Math.floor(rand() * quick.length)];
    data.entries.push(makeEntry({
      date: d, title, type: 'expense', amount: Math.round(lo + rand() * (hi - lo)),
      accountId: catName === L('Groceries', 'Продукты') ? food.id : main.id,
      categoryId: cat(catName), status: 'done', doneAt: nowIso(), isQuick: true
    }));
  }

  // A weekend trip under way: a tag with a budget and dates, a few payments
  // already made (one receipt split over two categories) and the train back
  // still planned.
  const vienna = makeTag({ name: L('Weekend in Vienna', 'Выходные в Вене'), color: 'teal', budget: 60000, startDate: addDays(today, -1), endDate: addDays(today, 1) });
  data.tags.push(vienna);
  const tripEntry = (f) => makeEntry({ type: 'expense', accountId: main.id, status: 'done', doneAt: nowIso(), tagIds: [vienna.id], ...f });
  data.entries.push(
    tripEntry({ date: addDays(today, -6), title: L('Train to Vienna', 'Поезд в Вену'), amount: 3890, categoryId: cat(L('Travel', 'Путешествия')) }),
    tripEntry({ date: addDays(today, -1), title: L('Hotel, two nights', 'Отель, две ночи'), amount: 21400, categoryId: cat(L('Travel', 'Путешествия')) }),
    tripEntry({
      date: addDays(today, -1), title: L('Dinner and concert', 'Ужин и концерт'), amount: 9650, categoryId: cat(L('Eating out', 'Кафе и рестораны')),
      splits: [
        { categoryId: cat(L('Eating out', 'Кафе и рестораны')), amount: 5850, note: '' },
        { categoryId: cat(L('Entertainment', 'Развлечения')), amount: 3800, note: L('Concert tickets', 'Билеты на концерт') }
      ]
    }),
    tripEntry({ date: today, title: L('Museum', 'Музей'), amount: 1800, categoryId: cat(L('Entertainment', 'Развлечения')), isQuick: true }),
    tripEntry({ date: addDays(today, 1), title: L('Train back', 'Поезд обратно'), amount: 3890, categoryId: cat(L('Travel', 'Путешествия')), status: 'planned', doneAt: null }));

  // A supermarket receipt split over groceries, the kids and the pharmacy
  // shelf: one payment on the account, three categories in the figures.
  const receiptParts = [
    { categoryId: cat(L('Groceries', 'Продукты')), amount: 4230, note: '' },
    { categoryId: cat(L('Kids', 'Дети')), amount: 890, note: L('Crayons and a sketchbook', 'Карандаши и альбом') },
    { categoryId: cat(L('Health', 'Здоровье')), amount: 650, note: L('Vitamins', 'Витамины') }
  ];
  data.entries.push(makeEntry({
    date: addDays(today, -3), title: L('Supermarket', 'Супермаркет'), type: 'expense', amount: 5770, accountId: food.id,
    categoryId: receiptParts[0].categoryId, splits: receiptParts, status: 'done', doneAt: nowIso(), isQuick: true
  }));

  // Eating out has a monthly limit and is close to it this month, so the
  // alerts have something to show; entertainment has room left.
  const limited = (catName, share) => {
    const c = data.categories.find(x => x.name === catName);
    // Counted the way the alerts count it: parts of split payments apart.
    const spent = categorySpentInMonth(data, c.id, month);
    c.monthlyLimit = spent > 0 ? Math.ceil(spent / share / 100) * 100 : 5000;
  };
  limited(L('Eating out', 'Кафе и рестораны'), 0.85);
  limited(L('Entertainment', 'Развлечения'), 0.4);

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
        date: payday, title: L('Split of the salary', 'Раскладка зарплаты'), type: 'transfer', amount: sum,
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
  [
    { text: 'lidl', title: 'Lidl', categoryId: cat(L('Groceries', 'Продукты')), accountId: food.id },
    { text: 'coffee corner', title: 'Coffee Corner', categoryId: cat(L('Eating out', 'Кафе и рестораны')) },
    { text: 'shell', title: 'Shell', categoryId: cat(L('Car', 'Авто')) },
    { text: 'city gym', type: 'expense', categoryId: cat(L('Health', 'Здоровье')) }
  ].forEach((r, i) => data.rules.push(makeRule({ type: 'expense', ...r, order: i + 1 })));
  return data;
}
