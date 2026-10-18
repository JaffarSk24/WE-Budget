import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { embedTouchIcon } from '../scripts/touch-icon.js';

const icon = readFileSync('public/apple-touch-icon.png');

describe('Home Screen icon in the page', () => {
  it('replaces the link of the source page with a data URL', () => {
    const out = embedTouchIcon(readFileSync('index.html', 'utf8'), icon);
    expect(out).toMatch(/<link rel="apple-touch-icon" sizes="180x180" href="data:image\/png;base64,/);
    expect(out).not.toContain('href="./apple-touch-icon.png"');
    expect(out).not.toContain('apple-touch-icon-precomposed');
  });

  // The page the web build produces goes through the plugins of
  // vite.config.js in web mode; a full build here would load the machine
  // and slow the timing tests that run alongside.
  it('the web build embeds the icon file itself, byte for byte', async () => {
    const config = (await import('../vite.config.js')).default({ mode: 'web' });
    const plugin = config.plugins.find(p => p.name === 'touch-icon-in-page');
    expect(plugin).toBeTruthy();
    const html = plugin.transformIndexHtml(readFileSync('index.html', 'utf8'));
    const links = [...html.matchAll(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/g)].map(m => m[1]);
    expect(links).toHaveLength(1);
    expect(links[0].startsWith('data:image/png;base64,')).toBe(true);
    const bytes = Buffer.from(links[0].slice('data:image/png;base64,'.length), 'base64');
    expect(bytes.equals(icon)).toBe(true);
  });

  it('keeps the desktop build as it was', async () => {
    const config = (await import('../vite.config.js')).default({ mode: 'production' });
    expect(config.plugins.some(p => p.name === 'touch-icon-in-page')).toBe(false);
  });
});
