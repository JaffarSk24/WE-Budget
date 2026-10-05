import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Source files must not carry invisible characters (zero-width, no-break
// spaces, byte order marks, bidi marks, tag characters) or long dashes.
// Where code needs such a character it writes the escape, e.g. '\ufeff'.
const FORBIDDEN = /[\u00a0\u200b-\u200f\u2028\u2029\u202a-\u202f\u2060-\u2064\ufeff\u2013\u2014]|[\u{e0000}-\u{e007f}]/u;

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(js|cjs|mjs|css|html|json|md|yml|ps1)$/.test(p) ? [p] : [];
  });
}

describe('source hygiene', () => {
  const targets = [...files('src'), ...files('tests'), ...files('scripts'), ...files('main'), ...files('site'),
    ...files('.github'), 'README.md', 'index.html', 'electron-main.cjs', 'preload.cjs', 'package.json',
    'vite.config.js', 'eslint.config.js'];

  it.each(targets)('%s is clean', (path) => {
    const lines = readFileSync(path, 'utf8').split('\n');
    const dirty = lines
      .map((line, i) => (FORBIDDEN.test(line) ? `${i + 1}: ${line.trim().slice(0, 60)}` : null))
      .filter(Boolean);
    expect(dirty).toEqual([]);
  });
});
