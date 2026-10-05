// Money is stored as integer cents everywhere. Floats only appear at the
// edges: parsing what the user typed and formatting for display.

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£', CZK: 'Kč', PLN: 'zł', UAH: '₴', RUB: '₽' };

// "2 450,50", "2450.5", "47,35€", "-12", "2,450.50" -> cents, or null.
export function parseMoney(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  if (typeof input !== 'string') return null;
  let s = input.replace(/[\s\u00a0\u202f€$£₴₽]/g, '').replace(/(kč|zł)$/i, '');
  if (!s) return null;

  const negative = s.startsWith('-');
  if (negative || s.startsWith('+')) s = s.slice(1);

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the later one is the decimal separator.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    const [intPart, ...rest] = s.split(decimalSep);
    if (rest.length !== 1) return null;
    const groups = intPart.split(groupSep);
    if (groups.slice(1).some(g => g.length !== 3)) return null;
    s = groups.join('') + '.' + rest[0];
  } else if (lastComma !== -1 || lastDot !== -1) {
    // One kind of separator. Repeated, or followed by exactly three digits,
    // it groups thousands ("1,300", "1.300.000"): money never has three
    // decimals. Otherwise it is the decimal separator ("47,35", "12.5").
    const sep = lastComma !== -1 ? ',' : '.';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    if (parts.length > 2 || tail.length === 3) {
      if (parts.slice(1).some(p => p.length !== 3)) return null;
      s = parts.join('');
    } else {
      s = parts.join('.');
    }
  }

  if (!/^\d+(\.\d{0,2})?$/.test(s) && !/^\d*\.\d{1,2}$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

export function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || code || '';
}

// 245050 -> "2 450,50€" (ru) / "2,450.50€" (en). The symbol is attached
// without a space on purpose.
export function formatMoney(cents, { currency = 'EUR', lang = 'ru', signed = false, decimals = true } = {}) {
  const value = Math.abs(cents || 0) / 100;
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const digits = decimals ? 2 : 0;
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
  let sign = '';
  if (cents < 0) sign = '-';
  else if (signed && cents > 0) sign = '+';
  return `${sign}${number}${currencySymbol(currency)}`;
}

// Value for an <input> field: plain number with the user's decimal separator.
export function centsToInput(cents, lang = 'ru') {
  if (cents === null || cents === undefined) return '';
  const s = (cents / 100).toFixed(2);
  return lang === 'ru' ? s.replace('.', ',') : s;
}

export function sumCents(values) {
  return values.reduce((acc, v) => acc + (v || 0), 0);
}
