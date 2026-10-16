// Data model of WE Budget: one JSON document, every record carries
// id / createdAt / updatedAt / deleted so that two devices can later merge
// their copies record by record. Deleted records are kept as tombstones;
// dropping them would let another device resurrect the record on sync.

export const SCHEMA_VERSION = 1;

export const COLLECTIONS = ['accounts', 'categories', 'templates', 'entries', 'goals', 'checks', 'reminders', 'rules', 'tags'];

export const ENTRY_TYPES = ['expense', 'income', 'transfer'];
export const ENTRY_STATUSES = ['planned', 'reserved', 'done', 'cancelled'];
export const ACCOUNT_KINDS = ['current', 'savings', 'credit', 'cash'];
export const SCHEDULE_FREQS = ['monthly', 'everyNMonths', 'yearly', 'weekly', 'once'];
export const RULE_FIELDS = ['title', 'note', 'any'];
export const RULE_MATCHES = ['contains', 'startsWith', 'exact'];
export const RULE_TYPES = ['expense', 'income', 'any'];
// Tag colors are names, not hex values: style.css gives each one a shade
// that reads on the dark and on the light theme.
export const TAG_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink', 'gray'];

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
  // Warnings on the overview and the phone's Today tab (and a notification
  // on the computer): category limits at 80% and 100%, free money below
  // alertFreeBelow, payments above alertLargePayment in the next 3 days.
  // Amounts in cents; null switches that warning off.
  alertsEnabled: true,
  alertFreeBelow: 10000,
  alertLargePayment: 50000,
  // Free money in the menu bar of the Mac (the notification area on Windows).
  menuBarFree: true,
  // Bank statement import: the column mapping last used for each account,
  // { [accountId]: { columns: { date: 'Completed Date', ... }, dateOrder } }.
  // Columns are kept by header name so a file with reordered columns still fits.
  importMappings: {},
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
    // Set when the template is a goal's monthly contribution.
    goalId: f.goalId || null,
    // Last day for which entries have already been generated.
    generatedThrough: f.generatedThrough || null,
    // Passed on to every generated entry.
    tagIds: tagList(f.tagIds),
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
    // Set on entries created or settled by a bank statement import: a hash
    // of the bank row, so importing the same statement again finds it.
    importKey: f.importKey || null,
    // A payment spread over several categories, see splits.js; null when
    // the whole amount is in categoryId.
    splits: Array.isArray(f.splits) && f.splits.length ? f.splits.map(p => ({ ...p })) : null,
    tagIds: tagList(f.tagIds),
    note: f.note || ''
  });
}

function tagList(ids) {
  return Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [];
}

// A tag groups payments across categories: a trip, a renovation, a
// project. With a budget and dates it becomes a small budget of its own.
export function makeTag(f = {}) {
  const budget = Number(f.budget);
  return base({
    name: f.name || '',
    color: TAG_COLORS.includes(f.color) ? f.color : TAG_COLORS[0],
    budget: Number.isFinite(budget) && budget > 0 ? Math.round(budget) : null,
    startDate: f.startDate || null,
    endDate: f.endDate || null,
    archived: !!f.archived
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
    archived: !!f.archived,
    // Set when the goal saves ahead for a recurring payment that does not
    // come every month: the goal follows that template's next occurrence.
    templateId: f.templateId || null,
    // The account the payment was paid from before saving ahead moved it to
    // the goal's account; it goes back there when saving ahead stops.
    templateAccountId: f.templateAccountId || null
  });
}

// A category rule: when a payment's text matches, it gets this category (and
// optionally an account and a clean title). Rules are tried in `order`, the
// first active match wins.
export function makeRule(f = {}) {
  const cents = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.abs(Math.round(Number(v))));
  return base({
    text: f.text || '',
    field: RULE_FIELDS.includes(f.field) ? f.field : 'any',
    match: RULE_MATCHES.includes(f.match) ? f.match : 'contains',
    type: RULE_TYPES.includes(f.type) ? f.type : 'any',
    minAmount: cents(f.minAmount),
    maxAmount: cents(f.maxAmount),
    categoryId: f.categoryId || null,
    accountId: f.accountId || null,
    title: f.title || '',
    order: Number.isFinite(f.order) ? f.order : 0,
    active: f.active !== false
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
    rules: [],
    tags: [],
    settings: { ...DEFAULT_SETTINGS, importMappings: {}, updatedAt: nowIso() }
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
  const mappings = data.settings.importMappings;
  data.settings.importMappings = mappings && typeof mappings === 'object' && !Array.isArray(mappings) ? { ...mappings } : {};
  if (!data.settings.updatedAt) data.settings.updatedAt = nowIso();
  data.entries.forEach(e => {
    if (e.plannedAmount === undefined) e.plannedAmount = e.amount || 0;
    if (!ENTRY_STATUSES.includes(e.status)) e.status = 'planned';
    if (!Array.isArray(e.tagIds)) e.tagIds = [];
    if (e.splits !== undefined && e.splits !== null && !Array.isArray(e.splits)) e.splits = null;
  });
  data.templates.forEach(t => {
    t.schedule = makeSchedule(t.schedule);
    if (!Array.isArray(t.tagIds)) t.tagIds = [];
  });
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
