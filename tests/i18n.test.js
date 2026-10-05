import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ru } from '../src/i18n/ru.js';
import { en } from '../src/i18n/en.js';

function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.js') ? [p] : [];
  });
}

describe('translations', () => {
  it('both languages have the same keys', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it('every key used in the code exists', () => {
    const text = sources('src').map(p => readFileSync(p, 'utf8')).join('\n') + readFileSync('index.html', 'utf8');
    const used = new Set();
    for (const m of text.matchAll(/\bt\('([a-zA-Z0-9-]+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/data-i18n="([a-zA-Z0-9-]+)"/g)) used.add(m[1]);
    for (const m of text.matchAll(/\btn\('([a-zA-Z0-9-]+)'/g)) ['one', 'few', 'many'].forEach(f => used.add(`${m[1]}-${f}`));
    const missing = [...used].filter(k => !(k in ru));
    expect(missing).toEqual([]);
  });

  it('no long dashes and no space before currency or percent in any text', () => {
    [ru, en].forEach(dict => Object.entries(dict).forEach(([key, value]) => {
      expect(value, key).not.toMatch(/[\u2013\u2014]/);
      expect(value, key).not.toMatch(/\s[%€]/);
    }));
  });
});
