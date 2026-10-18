// The Home Screen icon of the phone app, put into the page itself.
//
// iOS 27.2 Safari fetches a linked apple-touch-icon with a separate request
// and, when that fails for its own reasons, shows the site's first letter
// instead, even for a valid 200 image/png. An icon embedded as a data URL in
// the <head> needs no request, so "Add to Home Screen" always gets it. The
// file stays in public/: other browsers and the service worker use it.

import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

const LINK = /<link rel="apple-touch-icon"([^>]*?)href="\.\/apple-touch-icon\.png"([^>]*)>/;

// The page with the apple-touch-icon link pointing at a data URL of `png`.
export function embedTouchIcon(html, png) {
  if (!LINK.test(html)) throw new Error('index.html has no apple-touch-icon link to embed');
  const url = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  return html.replace(LINK, (m, before, after) => `<link rel="apple-touch-icon"${before}href="${url}"${after}>`);
}

// Vite plugin: embeds public/apple-touch-icon.png while the page is built.
export function touchIconInPage(file = new URL('../public/apple-touch-icon.png', import.meta.url)) {
  return {
    name: 'touch-icon-in-page',
    transformIndexHtml(html) {
      return embedTouchIcon(html, readFileSync(file));
    }
  };
}
