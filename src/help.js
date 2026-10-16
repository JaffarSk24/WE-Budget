// The in-app feature guide as data: every feature of the app with the group
// it belongs to, its icon and the place where it lives. The texts are
// i18n keys help-<id>-title, help-<id>-short and help-<id>-body. Pure
// functions only, so the Features screen, the phone and the tests share
// one list and one search.

import { foldText, queryTokens } from './search.js';

// The order of the headings on the Features screen.
export const HELP_GROUPS = ['start', 'plan', 'money', 'accounts', 'recurring', 'control', 'analytics', 'goals', 'safety', 'phone'];

// Settings sections a feature can point to, with the key of their title.
// The same ids mark the sections in Settings (data-section), so "Open"
// can scroll to the right one.
export const SETTINGS_SECTIONS = {
  sync: 'sync-title',
  reminders: 'reminder-title',
  quicklink: 'qlink-title',
  look: 'settings-look',
  accounting: 'settings-accounting',
  categories: 'settings-categories',
  tags: 'settings-tags',
  rules: 'rules-title',
  data: 'settings-data',
  updates: 'update-title'
};

// Dialogs a feature can open after the screen is shown, with the key of
// their title for the "Open" button.
export const HELP_ACTIONS = {
  search: 'search-title',
  quick: 'quick-title',
  whatif: 'whatif-title',
  journal: 'journal-title'
};

// view: a desktop screen (a key of VIEWS in main.js), 'settings' with an
// optional section, or 'phone' for what exists only in the phone app.
// phone: where the feature is in the phone app (a tab: today, accounts,
// more); without it the feature is on the computer only.
// phoneAction / action: a dialog to open there (see HELP_ACTIONS).
// isNew: added recently, shown by the "What is new" filter.
export const FEATURES = [
  { id: 'first-steps', group: 'start', icon: 'sparkles', view: 'overview', phone: 'today' },
  { id: 'daily-routine', group: 'start', icon: 'calendar-check', view: 'month', phone: 'today' },
  { id: 'language-theme', group: 'start', icon: 'palette', view: 'settings', section: 'look', phone: 'more' },

  { id: 'payment-calendar', group: 'plan', icon: 'calendar-days', view: 'month' },
  { id: 'statuses', group: 'plan', icon: 'circle', view: 'month', phone: 'today' },
  { id: 'balance-column', group: 'plan', icon: 'list', view: 'month' },
  { id: 'bulk-actions', group: 'plan', icon: 'list-checks', view: 'month' },
  { id: 'keyboard', group: 'plan', icon: 'keyboard', view: 'month' },
  { id: 'month-calendar', group: 'plan', icon: 'calendar-range', view: 'month', isNew: true },
  { id: 'inline-edit', group: 'plan', icon: 'pencil', view: 'month' },
  { id: 'search', group: 'plan', icon: 'search', view: 'month', action: 'search', phone: 'today', phoneAction: 'search', isNew: true },

  { id: 'quick-entry', group: 'money', icon: 'plus', view: 'overview', action: 'quick', phone: 'today', phoneAction: 'quick' },
  { id: 'quick-links', group: 'money', icon: 'smartphone', view: 'settings', section: 'quicklink', phone: 'more', isNew: true },
  { id: 'allocation', group: 'money', icon: 'split', view: 'accounts' },
  { id: 'split-payments', group: 'money', icon: 'layers', view: 'month', isNew: true },
  { id: 'tags', group: 'money', icon: 'tags', view: 'settings', section: 'tags', isNew: true },
  { id: 'pass-through', group: 'money', icon: 'arrow-left-right', view: 'month' },
  { id: 'category-rules', group: 'money', icon: 'wand-2', view: 'settings', section: 'rules', isNew: true },
  { id: 'bank-import', group: 'money', icon: 'import', view: 'accounts', isNew: true },
  { id: 'reconcile', group: 'money', icon: 'scale', view: 'accounts' },

  { id: 'envelopes', group: 'accounts', icon: 'folder-open', view: 'accounts', phone: 'accounts' },
  { id: 'free-money', group: 'accounts', icon: 'wallet', view: 'overview', phone: 'today' },
  { id: 'set-aside', group: 'accounts', icon: 'piggy-bank', view: 'month', phone: 'today' },
  { id: 'goal-money', group: 'accounts', icon: 'snowflake', view: 'goals' },
  { id: 'tracking-start', group: 'accounts', icon: 'flag', view: 'settings', section: 'accounting' },
  { id: 'adjustments', group: 'accounts', icon: 'sliders-horizontal', view: 'accounts' },
  { id: 'net-worth', group: 'accounts', icon: 'gem', view: 'accounts', phone: 'accounts', isNew: true },

  { id: 'recurring', group: 'recurring', icon: 'repeat', view: 'templates' },
  { id: 'every-n-months', group: 'recurring', icon: 'calendar-clock', view: 'templates' },
  { id: 'save-ahead', group: 'recurring', icon: 'piggy-bank', view: 'templates', isNew: true },
  { id: 'recurring-overview', group: 'recurring', icon: 'eye', view: 'templates', isNew: true },

  { id: 'overview', group: 'control', icon: 'layout-dashboard', view: 'overview', phone: 'today' },
  { id: 'forecast', group: 'control', icon: 'trending-up', view: 'overview' },
  { id: 'first-shortfall', group: 'control', icon: 'alert-triangle', view: 'overview' },
  { id: 'runway', group: 'control', icon: 'gauge', view: 'overview', phone: 'today', isNew: true },
  { id: 'alerts', group: 'control', icon: 'bell', view: 'settings', section: 'reminders', phone: 'today', isNew: true },
  { id: 'what-if', group: 'control', icon: 'sparkle', view: 'overview', action: 'whatif', isNew: true },
  { id: 'limits', group: 'control', icon: 'calculator', view: 'settings', section: 'categories', isNew: true },
  { id: 'month-plan', group: 'control', icon: 'check-circle-2', view: 'overview' },

  { id: 'analytics-months', group: 'analytics', icon: 'chart-column', view: 'analytics' },
  { id: 'analytics-categories', group: 'analytics', icon: 'chart-line', view: 'analytics' },
  { id: 'income-sources', group: 'analytics', icon: 'arrow-down', view: 'analytics' },
  { id: 'plan-fact', group: 'analytics', icon: 'scale', view: 'analytics' },
  { id: 'money-flow', group: 'analytics', icon: 'waypoints', view: 'analytics', isNew: true },
  { id: 'tag-analytics', group: 'analytics', icon: 'tag', view: 'analytics' },

  { id: 'goals', group: 'goals', icon: 'target', view: 'goals' },
  { id: 'debts', group: 'goals', icon: 'landmark', view: 'debts', phone: 'accounts', isNew: true },

  { id: 'sync', group: 'safety', icon: 'cloud', view: 'settings', section: 'sync', phone: 'more' },
  { id: 'encryption', group: 'safety', icon: 'lock', view: 'settings', section: 'sync', phone: 'more', isNew: true },
  { id: 'backups', group: 'safety', icon: 'archive', view: 'settings', section: 'data' },
  { id: 'journal', group: 'safety', icon: 'history', view: 'settings', section: 'data', action: 'journal', phone: 'more', phoneAction: 'journal', isNew: true },
  { id: 'csv-export', group: 'safety', icon: 'file-spreadsheet', view: 'settings', section: 'data' },
  { id: 'demo', group: 'safety', icon: 'sparkles', view: 'settings', section: 'data' },

  { id: 'phone-app', group: 'phone', icon: 'smartphone', view: 'phone', phone: 'today' },
  { id: 'reminders', group: 'phone', icon: 'calendar', view: 'settings', section: 'reminders', phone: 'more' },
  { id: 'notifications', group: 'phone', icon: 'bell-ring', view: 'settings', section: 'reminders' },
  { id: 'menu-bar', group: 'phone', icon: 'panel-top', view: 'settings', section: 'look' },
  { id: 'updates', group: 'phone', icon: 'download', view: 'settings', section: 'updates' }
];

export function helpKeys(id) {
  return { title: `help-${id}-title`, short: `help-${id}-short`, body: `help-${id}-body` };
}

// Where a feature can be used: both, only on the computer or only on the
// phone. Decides the small badge and whether "Open" is offered.
export function availability(feature) {
  if (feature.view === 'phone') return 'phone';
  return feature.phone ? 'both' : 'desktop';
}

// One folded string of everything the search looks at. `tr` turns a key
// into text, so the tests can pass a dictionary of either language.
export function featureText(feature, tr) {
  const k = helpKeys(feature.id);
  return foldText([tr(k.title), tr(k.short), tr(k.body)].join(' '));
}

// Every word of the query must be somewhere in the title, the short line
// or the description; case and diacritics do not matter.
export function matchesQuery(feature, query, tr) {
  const words = queryTokens(query);
  if (!words.length) return true;
  const text = featureText(feature, tr);
  return words.every(w => text.includes(w));
}

export function filterFeatures(features, { query = '', onlyNew = false } = {}, tr) {
  return features.filter(f => (!onlyNew || f.isNew) && matchesQuery(f, query, tr));
}

// The found features under their group headings, in the order of
// HELP_GROUPS; groups without anything found are left out.
export function groupFeatures(features) {
  return HELP_GROUPS
    .map(group => ({ group, features: features.filter(f => f.group === group) }))
    .filter(g => g.features.length);
}

// A description is plain text: paragraphs are separated by an empty line,
// a paragraph whose lines start with "- " is a list and one whose lines
// start with "1. " is a numbered list.
export function bodyBlocks(text) {
  return String(text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.every(l => l.startsWith('- '))) return { type: 'ul', items: lines.map(l => l.slice(2).trim()) };
    if (lines.every(l => /^\d+\.\s/.test(l))) return { type: 'ol', items: lines.map(l => l.replace(/^\d+\.\s+/, '')) };
    return { type: 'p', text: lines.join(' ') };
  });
}
