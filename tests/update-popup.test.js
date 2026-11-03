import { describe, it, expect } from 'vitest';
import { notesForApp } from '../src/update-popup.js';

describe('release notes in the update window', () => {
  it('stop before the download section of the release page', () => {
    const md = 'Fixes.\n\n- One\n- Two\n\n**Downloads**\n\n- macOS: `x.dmg`';
    expect(notesForApp(md)).toBe('Fixes.\n\n- One\n- Two');
  });

  it('keep notes without a download section whole, and empty notes empty', () => {
    expect(notesForApp('Only this.')).toBe('Only this.');
    expect(notesForApp('')).toBe('');
    expect(notesForApp(undefined)).toBe('');
  });
});
