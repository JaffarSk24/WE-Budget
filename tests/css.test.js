import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Merging stylesheet changes from parallel branches can drop the closing
// brace of a media block; the build then fails or, worse, the rules after it
// end up inside the media query. Comments and strings are skipped so braces
// in them do not count.
function unclosedBlocks(css) {
  const stack = [];
  let line = 1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\n') line++;
    else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      for (let j = i; j < (end < 0 ? css.length : end); j++) if (css[j] === '\n') line++;
      i = end < 0 ? css.length : end + 1;
    } else if (ch === '"' || ch === "'") {
      const end = css.indexOf(ch, i + 1);
      i = end < 0 ? css.length : end;
    } else if (ch === '{') stack.push(line);
    else if (ch === '}') {
      if (!stack.length) return { extra: line };
      stack.pop();
    }
  }
  return { open: stack };
}

describe('style.css', () => {
  it('closes every block it opens', () => {
    const result = unclosedBlocks(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));
    expect(result).toEqual({ open: [] });
  });
});
