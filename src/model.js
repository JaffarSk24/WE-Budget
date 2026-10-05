// Data model of WE Budget: one JSON document, every record carries
// id / createdAt / updatedAt / deleted so that two devices can later merge
// their copies record by record. Deleted records are kept as tombstones;
// dropping them would let another device resurrect the record on sync.

export const SCHEMA_VERSION = 1;

export const COLLECTIONS = ['accounts', 'categories', 'templates', 'entries', 'goals', 'checks', 'reminders'];

export const ENTRY_TYPES = ['expense', 'income', 'transfer'];
export const ENTRY_STATUSES = ['planned', 'reserved', 'done', 'cancelled'];
export const ACCOUNT_KINDS = ['current', 'savings', 'credit', 'cash'];
export const SCHEDULE_FREQS = ['monthly', 'everyNMonths', 'yearly', 'weekly', 'once'];

export const DEFAULT_SETTINGS = {
  language: 'ru',
  theme: 'dark',
  currency: 'EUR',
  // Account balances are computed from this day on. Entries before it are
  // history: they feed analytics and the month views, not the balances.
  trackingStart: null,
  defaultIncomeAccountId: null,
  forecastMonths: 3,
  reminderTime: '23:00',
  macNotifications: true,
  calendarReminders: false,
  // The app's own calendar in Google Calendar, shared by all devices.
  reminderCalendarId: null,
  morningDigest: false,
  // Free money in the menu bar of the Mac (the notification area on Windows).
  menuBarFree: true,
  onboarded: false
};

export function newId() {
  return globalThis.crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

function base(fields) {
  const now = nowIso();
  return { id: newId(), createdAt: now, updatedAt: now, deleted: false, ...fields };
}

export function makeAccount(f = {}) {
  return base({
    name: f.name || '',
    parentId: f.parentId || null,
    bank: f.bank || '',
    kind: ACCOUNT_KINDS.includes(f.kind) ? f.kind : 'current',
    openingBalance: f.openingBalance || 0,
    color: f.color || null,
    order: f.order ?? 0,
    archived: !!f.archived,
    note: f.note || ''
  });
}

export function makeCategory(f = {}) {
  return base({
    name: f.name || '',
    type: f.type === 'income' ? 'income' : 'expense',
    parentId: f.parentId || null,
    color: f.color || null,
    monthlyLimit: f.monthlyLimit ?? null,
    archived: !!f.archived
  });
}

export function makeSchedule(s = {}) {
  return {
    freq: SCHEDULE_FREQS.includes(s.freq) ? s.freq : 'monthly',
    interval: Math.max(1, Number(s.interval) || 1),
    day: Math.min(31, Math.max(1, Number(s.day) || 1)),
    weekdays: Array.isArray(s.weekdays) ? s.weekdays.filter(w => w >= 0 && w <= 6) : [],
    // Every-N-months payments can still show up every month, with a zero
    // amount in the months they are not due, so the row is never out of sight.
    fillGaps: !!s.fillGaps,
    startDate: s.startDate || null,
    endDate: s.endDate || null
  };
}

export function makeTemplate(f = {}) {
  return base({
    title: f.title || '',
    type: ENTRY_TYPES.includes(f.type) ? f.type : 'expense',
    amount: f.amount || 0,
    amountIsEstimate: !!f.amountIsEstimate,
    accountId: f.accountId || null,
    toAccountId: f.toAccountId || null,
    categoryId: f.categoryId || null,
    schedule: makeSchedule(f.schedule),
    isTransit: !!f.isTransit,
    active: f.active !== false,
    // Last day for which entries have already been generated.
    generatedThrough: f.generatedThrough || null,
    note: f.note || ''
  });
}

export function makeEntry(f = {}) {
  const amount = f.amount ?? f.plannedAmount ?? 0;
  return base({
    templateId: f.templateId || null,
    // Scheduled day of a template occurrence; keeps it unique even after
    // the entry itself is moved to another date.
    occurrence: f.occurrence || null,
    date: f.date,
    title: f.title || '',
    type: ENTRY_TYPES.includes(f.type) ? f.type : 'expense',
    plannedAmount: f.plannedAmount ?? amount,
    amount,
    accountId: f.accountId || null,
    toAccountId: f.toAccountId || null,
    categoryId: f.categoryId || null,
    status: ENTRY_STATUSES.includes(f.status) ? f.status : 'planned',
    reservedAt: f.reservedAt || null,
    doneAt: f.doneAt || null,
    allocationId: f.allocationId || null,
    isTransit: !!f.isTransit,
    isAdjustment: !!f.isAdjustment,
    isQuick: !!f.isQuick,
    note: f.note || ''
  });
}

export function makeCheck(f = {}) {
  return base({
    accountId: f.accountId,
    date: f.date,
    actualBalance: f.actualBalance || 0,
    computedBalance: f.computedBalance || 0,
    adjustmentEntryId: f.adjustmentEntryId || null,
    note: f.note || ''
  });
}

export function makeGoal(f = {}) {
  return base({
    name: f.name || '',
    targetAmount: f.targetAmount || 0,
    accountId: f.accountId || null,
    deadline: f.deadline || null,
    archived: !!f.archived
  });
}

export function emptyData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    // Identifies this budget as a whole. Restoring a backup, loading the demo
    // or starting over creates a new dataset; sync only merges records of the
    // same dataset and treats a different one as a replacement.
    datasetId: newId(),
    datasetAt: nowIso(),
    accounts: [],
    categories: [],
    templates: [],
    entries: [],
    goals: [],
    checks: [],
    reminders: [],
    settings: { ...DEFAULT_SETTINGS, updatedAt: nowIso() }
  };
}

// Brings any parsed document to the current shape without throwing.
// Unknown fields are kept, missing ones get defaults.
export function normalizeData(raw) {
  const data = emptyData();
  if (!raw || typeof raw !== 'object') return data;
  COLLECTIONS.forEach(name => {
    if (Array.isArray(raw[name])) {
      data[name] = raw[name].filter(r => r && typeof r === 'object' && r.id);
    }
  });
  if (raw.datasetId) {
    data.datasetId = raw.datasetId;
    data.datasetAt = raw.datasetAt || data.datasetAt;
  }
  data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  if (!data.settings.updatedAt) data.settings.updatedAt = nowIso();
  data.entries.forEach(e => {
    if (e.plannedAmount === undefined) e.plannedAmount = e.amount || 0;
    if (!ENTRY_STATUSES.includes(e.status)) e.status = 'planned';
  });
  data.templates.forEach(t => { t.schedule = makeSchedule(t.schedule); });
  data.schemaVersion = SCHEMA_VERSION;
  return data;
}

export function hasAnyData(data) {
  return COLLECTIONS.some(name => (data[name] || []).some(r => !r.deleted));
}

export function live(list) {
  return (list || []).filter(r => !r.deleted);
}

export function defaultCategories(lang = 'ru') {
  const ru = lang === 'ru';
  const expense = ru
    ? ['Жильё', 'Продукты', 'Транспорт', 'Авто', 'Связь и подписки', 'Здоровье', 'Дети', 'Кредиты', 'Кафе и рестораны', 'Развлечения', 'Одежда', 'Подарки', 'Путешествия', 'Налоги и сборы', 'Банковские комиссии', 'Прочее']
    : ['Housing', 'Groceries', 'Transport', 'Car', 'Phone and subscriptions', 'Health', 'Kids', 'Loans', 'Eating out', 'Entertainment', 'Clothing', 'Gifts', 'Travel', 'Taxes and fees', 'Bank fees', 'Other'];
  const income = ru
    ? ['Зарплата', 'Подработка', 'Лицензии и роялти', 'Пособия', 'Возвраты', 'Прочие доходы']
    : ['Salary', 'Side income', 'Licensing and royalties', 'Benefits', 'Refunds', 'Other income'];
  return [
    ...expense.map((name, i) => makeCategory({ name, type: 'expense', order: i })),
    ...income.map((name, i) => makeCategory({ name, type: 'income', order: i }))
  ];
}
