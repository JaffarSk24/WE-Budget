// Runs before every other module in the browser build. Google's sign-in
// answer is handled first (in the sign-in window the app does not start at
// all), and the web transport takes the place of the desktop bridge before
// the sync engine looks for one.

import { createWebCloud, handleAuthCallback } from './cloud-web.js';

const desktop = typeof window !== 'undefined' && Boolean(window.weStorage);

export const isAuthWindow = !desktop && typeof window !== 'undefined' && handleAuthCallback();

if (!desktop && typeof window !== 'undefined' && !window.weCloud) window.weCloud = createWebCloud();
