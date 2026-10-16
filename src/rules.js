// Category rules: a payment whose text matches a rule gets the rule's
// category (and optionally its account and a clean title). Pure functions;
// used by the quick entry dialog and the bank statement import.

// Lower case, without diacritics, single spaces: 'Potraviny  Žilina' and
// 'POTRAVINY ZILINA' are the same text for a rule.
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function textMatches(haystack, needle, match) {
  const s = normalizeText(haystack);
  if (!s) return false;
  if (match === 'exact') return s === needle;
  if (match === 'startsWith') return s.startsWith(needle);
  return s.includes(needle);
}

export function sortRules(rules) {
  return (rules || [])
    .filter(r => r && !r.deleted)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export function ruleMatches(rule, { text = '', note = '', type = null, amount = null } = {}) {
  if (!rule || rule.deleted || rule.active === false) return false;
  const needle = normalizeText(rule.text);
  if (!needle) return false;
  if (rule.type && rule.type !== 'any' && type && rule.type !== type) return false;
  const abs = amount === null || amount === undefined ? null : Math.abs(amount);
  // Amount limits only apply when the amount is known: a note typed before
  // the amount still finds its category.
  if (abs !== null && abs > 0) {
    if (rule.minAmount !== null && rule.minAmount !== undefined && abs < rule.minAmount) return false;
    if (rule.maxAmount !== null && rule.maxAmount !== undefined && abs > rule.maxAmount) return false;
  }
  const field = rule.field || 'any';
  const places = field === 'title' ? [text] : field === 'note' ? [note] : [text, note];
  return places.some(p => textMatches(p, needle, rule.match || 'contains'));
}

// The first active rule in `order` that matches, or null.
export function applyRules(rules, item) {
  return sortRules(rules).find(r => ruleMatches(r, item)) || null;
}

// Words that banks add around the merchant name and that say nothing about
// what the payment was. Compared without diacritics, word by word.
const NOISE_PHRASES = [
  'platba kartou', 'platba kartu', 'nakup kartou', 'dekujeme za nakup', 'dekuje za nakup', 'dakujeme za nakup',
  'card payment', 'card transaction', 'debit card', 'credit card', 'contactless', 'apple pay', 'google pay',
  'payment to', 'payment from', 'transfer to', 'transfer from', 'to', 'from', 'platba', 'nakup', 'vyber',
  'payment', 'purchase', 'pos', 'visa', 'mastercard', 'maestro', 'eur', 'czk', 'usd', 'gbp', 'kc',
  'ref', 'vs', 'ks', 'ss', 'id'
].map(p => p.split(' '));

// A token that changes from one payment to the next: card numbers and
// masks, dates, times, amounts, references with long digit runs, numbers.
function isVolatile(token) {
  if (!/[\p{L}]/u.test(token)) return true;
  if (/\d{4,}/.test(token)) return true;
  if (/[*]{2,}|^x{3,}\d*$/i.test(token)) return true;
  return false;
}

const LEADING_ONLY = new Set(['to', 'from']);
const edgeTrim = (w) => w.replace(/^[^\p{L}\p{N}&]+|[^\p{L}\p{N}&]+$/gu, '');

// Proposes a short, stable piece of a bank description for a new rule:
// 'LIDL DEKUJE ZA NAKUP 1234' -> 'LIDL', 'Card payment 4532 **** 1234
// Coffee Corner 12.03.2026' -> 'Coffee Corner'. The piece is the first run
// of words next to each other in the text (a rule looks for it as one
// piece), at most three words, as the bank wrote them.
export function suggestRuleText(text) {
  const original = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!original) return '';
  const raw = original.split(' ');
  const plain = raw.map(w => normalizeText(edgeTrim(w)));
  const keep = raw.map(w => Boolean(edgeTrim(w)) && !isVolatile(edgeTrim(w)));
  for (let i = 0; i < raw.length; i++) {
    const phrase = NOISE_PHRASES.find(p => (p.length > 1 || !LEADING_ONLY.has(p[0]) || i === 0) && p.every((w, k) => plain[i + k] === w));
    if (phrase) phrase.forEach((w, k) => { keep[i + k] = false; });
  }
  const start = keep.indexOf(true);
  if (start === -1) {
    const words = raw.map(edgeTrim).filter(w => w && /\p{L}/u.test(w));
    return (words.length ? words.slice(0, 3).join(' ') : original.slice(0, 30)).trim();
  }
  const run = [];
  for (let i = start; i < raw.length && keep[i] && run.length < 3; i++) {
    run.push(raw[i]);
    // Punctuation inside the run would have to be typed exactly; stop there.
    if (/[^\p{L}\p{N}&.]$/u.test(raw[i])) break;
  }
  run[0] = edgeTrim(run[0]);
  run[run.length - 1] = edgeTrim(run[run.length - 1]);
  return run.join(' ').trim();
}

// 'LIDL' -> 'Lidl', 'COFFEE CORNER' -> 'Coffee Corner'. Mixed case is kept
// as the bank wrote it.
export function cleanTitle(text) {
  const s = String(text ?? '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}
