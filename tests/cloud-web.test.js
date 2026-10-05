import { describe, it, expect, beforeEach } from 'vitest';
import { authUrl, parseAuthHash, redirectUri, handleAuthCallback, WEB_CLIENT_ID } from '../src/web/cloud-web.js';

const DRIVE = 'https://www.googleapis.com/auth/drive.appdata';
const EMAIL = 'https://www.googleapis.com/auth/userinfo.email';
const CALENDAR = 'https://www.googleapis.com/auth/calendar.app.created';

describe('web sign-in address', () => {
  it('asks for Drive and the email, the calendar only when wanted', () => {
    const plain = new URL(authUrl({ state: 's', redirect: 'https://jaffarsk24.github.io/WE-Budget/app/' }));
    expect(plain.searchParams.get('client_id')).toBe(WEB_CLIENT_ID);
    expect(plain.searchParams.get('response_type')).toBe('token');
    expect(plain.searchParams.get('scope')).toBe(`${DRIVE} ${EMAIL}`);
    expect(plain.searchParams.get('include_granted_scopes')).toBe('true');
    expect(plain.searchParams.has('login_hint')).toBe(false);
    const more = new URL(authUrl({ state: 's', redirect: 'x', calendar: true, loginHint: 'a@example.com' }));
    expect(more.searchParams.get('scope')).toBe(`${DRIVE} ${EMAIL} ${CALENDAR}`);
    expect(more.searchParams.get('login_hint')).toBe('a@example.com');
  });

  it('returns to the app page itself', () => {
    expect(redirectUri({ origin: 'https://jaffarsk24.github.io', pathname: '/WE-Budget/app/index.html' })).toBe('https://jaffarsk24.github.io/WE-Budget/app/');
    expect(redirectUri({ origin: 'http://localhost:3010', pathname: '/' })).toBe('http://localhost:3010/');
  });

  it('reads a token or an error from the address, and ignores other hashes', () => {
    expect(parseAuthHash(`#access_token=t1&expires_in=3599&scope=${encodeURIComponent(`${DRIVE} ${EMAIL}`)}&state=s1`))
      .toEqual({ state: 's1', error: null, accessToken: 't1', expiresIn: 3599, scope: `${DRIVE} ${EMAIL}` });
    expect(parseAuthHash('#error=access_denied&state=s1')).toMatchObject({ state: 's1', error: 'access_denied', accessToken: null });
    expect(parseAuthHash('#month')).toBeNull();
    expect(parseAuthHash('')).toBeNull();
  });
});

describe('Google answer in the sign-in window', () => {
  const posted = [];
  beforeEach(() => {
    localStorage.clear();
    posted.length = 0;
    globalThis.history = { replaceState: () => {} };
    globalThis.BroadcastChannel = class { postMessage(m) { posted.push(m); } close() {} };
    window.close = () => {};
  });
  const answer = (hash) => { globalThis.location = { hash, pathname: '/WE-Budget/app/', search: '', origin: 'https://jaffarsk24.github.io' }; };

  it('stores the token, tells the app, and keeps the app from starting in the window', () => {
    localStorage.setItem('we-budget-web-pending', JSON.stringify({ state: 's1', mode: 'window' }));
    answer(`#access_token=t1&expires_in=3600&scope=${encodeURIComponent(`${DRIVE} ${EMAIL}`)}&state=s1`);
    expect(handleAuthCallback()).toBe(true);
    const auth = JSON.parse(localStorage.getItem('we-budget-web-auth'));
    expect(auth.accessToken).toBe('t1');
    expect(auth.expiry).toBeGreaterThan(Date.now() + 3500 * 1000);
    expect(posted).toEqual([{ state: 's1', ok: true }]);
  });

  it('refuses a sign-in without the Drive permission', () => {
    localStorage.setItem('we-budget-web-pending', JSON.stringify({ state: 's2', mode: 'window' }));
    answer(`#access_token=t2&expires_in=3600&scope=${encodeURIComponent(EMAIL)}&state=s2`);
    handleAuthCallback();
    expect(localStorage.getItem('we-budget-web-auth')).toBeNull();
    expect(JSON.parse(localStorage.getItem('we-budget-web-result'))).toEqual({ state: 's2', ok: false, error: 'drive_scope_missing' });
  });

  it('ignores an answer it did not ask for', () => {
    localStorage.setItem('we-budget-web-pending', JSON.stringify({ state: 'mine', mode: 'window' }));
    answer(`#access_token=evil&expires_in=3600&scope=${encodeURIComponent(DRIVE)}&state=other`);
    expect(handleAuthCallback()).toBe(false);
    expect(localStorage.getItem('we-budget-web-auth')).toBeNull();
  });

  it('after a plain redirect the app goes on in the same tab', () => {
    localStorage.setItem('we-budget-web-pending', JSON.stringify({ state: 's3', mode: 'redirect' }));
    answer(`#access_token=t3&expires_in=3600&scope=${encodeURIComponent(`${DRIVE} ${EMAIL}`)}&state=s3`);
    expect(handleAuthCallback()).toBe(false);
    expect(JSON.parse(localStorage.getItem('we-budget-web-auth')).accessToken).toBe('t3');
  });
});
