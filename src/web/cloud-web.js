// Google sign-in and the Drive and Calendar transport for the web and phone
// app: the same bridge the desktop preload offers as window.weCloud, done in
// the browser.
//
// Sign-in uses OAuth for client-side apps: Google returns a short-lived
// access token (an hour) in the address of the page it redirects to. The
// sign-in page opens in a window of its own, from the tap on the button: in
// an app installed on the iPhone home screen such a window stays inside the
// app (Apple's guidance since iOS 16.4), while a plain redirect would leave
// for Safari, which keeps a separate storage. The window comes back to this
// app's address, stores the token in the shared storage, tells the app over
// a BroadcastChannel and closes.
//
// A web app gets no long-lived token, so after an hour the next sync needs a
// tap to renew access: the same window opens, Google answers at once while
// its session in this browser is alive, and the window closes. The budget
// itself always stays on the device.

export const WEB_CLIENT_ID = '891678002432-rbhgs5t30uem899fi6pu0jkb67bt9vtq.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const REMOTE_NAME = 'we-budget-data.json.gz';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';

const AUTH_KEY = 'we-budget-web-auth';        // { accessToken, expiry, scope }
const ACCOUNT_KEY = 'we-budget-web-account';  // { email }
const STATE_KEY = 'we-budget-cloud-state';    // the engine's per-device sync state
const PENDING_KEY = 'we-budget-web-pending';  // { state, startedAt }
const RESULT_KEY = 'we-budget-web-result';    // { state, ok, error }
const CHANNEL = 'we-budget-auth';
const TIMEOUT_MS = 30000;
const LOGIN_WAIT_MS = 5 * 60 * 1000;

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* storage full or blocked: sign-in will not stick */ }
}

function randomState() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// The address Google returns to: this app's own page, without index.html,
// query or hash (it must match the redirect URIs of the OAuth client).
export function redirectUri(loc = location) {
  return loc.origin + loc.pathname.replace(/index\.html$/, '');
}

export function authUrl({ state, redirect, calendar = false, loginHint = '' }) {
  const scopes = [DRIVE_SCOPE, EMAIL_SCOPE];
  if (calendar) scopes.push(CALENDAR_SCOPE);
  const params = new URLSearchParams({
    client_id: WEB_CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'token',
    scope: scopes.join(' '),
    include_granted_scopes: 'true',
    state
  });
  if (loginHint) params.set('login_hint', loginHint);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

// Reads Google's answer from the address hash: a token or an error.
export function parseAuthHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (!params.has('access_token') && !params.has('error')) return null;
  return {
    state: params.get('state') || '',
    error: params.get('error') || null,
    accessToken: params.get('access_token') || null,
    expiresIn: Number(params.get('expires_in') || 3600),
    scope: params.get('scope') || ''
  };
}

function grants(scope, wanted) {
  return String(scope || '').split(/\s+/).includes(wanted);
}

// Runs first when the page loads. When the page is Google's answer, stores
// the result and tells the app. In the sign-in window it then closes (or
// asks to be closed) and returns true: the app must not start in it. After
// a plain redirect (windows blocked) it returns false and the app goes on
// in this tab, finishing the sign-in itself.
export function handleAuthCallback() {
  const answer = parseAuthHash(location.hash);
  if (!answer) return false;
  const pending = read(PENDING_KEY);
  history.replaceState(null, '', location.pathname + location.search);
  if (!pending || pending.state !== answer.state) return false;
  let result;
  if (answer.error) {
    result = { state: answer.state, ok: false, error: answer.error === 'access_denied' ? 'access_denied' : answer.error };
  } else if (!grants(answer.scope, DRIVE_SCOPE)) {
    result = { state: answer.state, ok: false, error: 'drive_scope_missing' };
  } else {
    write(AUTH_KEY, {
      accessToken: answer.accessToken,
      expiry: Date.now() + answer.expiresIn * 1000,
      scope: answer.scope
    });
    result = { state: answer.state, ok: true };
  }
  write(RESULT_KEY, result);
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(result);
    channel.close();
  } catch (e) { /* the app also polls the storage */ }
  if (pending.mode !== 'window') return false;
  setTimeout(() => {
    try { window.close(); } catch (e) { /* not closable: the note below stays */ }
  }, 50);
  return true;
}

function tokenInfo() {
  const auth = read(AUTH_KEY);
  if (!auth || !auth.accessToken) return null;
  return auth;
}

function validToken() {
  const auth = tokenInfo();
  return auth && Date.now() < auth.expiry - 60 * 1000 ? auth.accessToken : null;
}

function renewError() {
  const err = new Error('renew_needed');
  err.renew = true;
  return err;
}

function isNetworkError(e) {
  return e && (e.name === 'TypeError' || e.name === 'TimeoutError' || /network|failed to fetch|load failed/i.test(e.message || ''));
}

async function api(url, options = {}) {
  const token = validToken();
  if (!token) throw renewError();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(options.timeout || TIMEOUT_MS)
  });
  if (res.status === 401) {
    write(AUTH_KEY, { ...tokenInfo(), expiry: 0 });
    throw renewError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    if (res.status === 403 && /insufficient/i.test(body)) err.scopeMissing = true;
    throw err;
  }
  return res;
}

async function guard(fn) {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return {
      ok: false, error: e.message, renew: Boolean(e.renew), reauth: false, reason: null,
      status: e.status || null, scopeMissing: Boolean(e.scopeMissing), offline: isNetworkError(e)
    };
  }
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(buffer) {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

let waiting = null;

// Opens Google's sign-in in a window of its own (from the tap) and waits
// for the answer. Falls back to leaving the page when windows are blocked.
function signInWindow({ calendar = false } = {}) {
  if (waiting) return waiting;
  const state = randomState();
  write(RESULT_KEY, null);
  const account = read(ACCOUNT_KEY);
  const url = authUrl({ state, redirect: redirectUri(), calendar, loginHint: account && account.email ? account.email : '' });
  const popup = window.open('about:blank', 'we-budget-auth');
  if (!popup) {
    write(PENDING_KEY, { state, mode: 'redirect', startedAt: Date.now() });
    location.assign(url);
    return new Promise(() => {});
  }
  write(PENDING_KEY, { state, mode: 'window', startedAt: Date.now() });
  popup.location.href = url;

  waiting = new Promise(resolve => {
    let channel = null;
    const started = Date.now();
    const finish = (result) => {
      clearInterval(poll);
      if (channel) channel.close();
      write(PENDING_KEY, null);
      waiting = null;
      try { if (!popup.closed) popup.close(); } catch (e) { /* already gone */ }
      resolve(result);
    };
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (event) => { if (event.data && event.data.state === state) finish(event.data); };
    } catch (e) { channel = null; }
    let closedSince = 0;
    const poll = setInterval(() => {
      const result = read(RESULT_KEY);
      if (result && result.state === state) return finish(result);
      if (Date.now() - started > LOGIN_WAIT_MS) return finish({ ok: false, error: 'timeout' });
      let closed;
      try { closed = popup.closed; } catch (e) { closed = false; }
      if (closed) {
        // The answer may still be on its way through the storage.
        closedSince = closedSince || Date.now();
        if (Date.now() - closedSince > 3000) finish({ ok: false, error: 'cancelled' });
      }
    }, 400);
  });
  return waiting;
}

// After a sign-in that left the page (windows blocked), the app finishes it
// on its next start: the token is stored, the account is not yet.
export async function finishRedirectSignIn() {
  const result = read(RESULT_KEY);
  if (!result || !result.ok || read(ACCOUNT_KEY)) return false;
  write(RESULT_KEY, null);
  try {
    write(ACCOUNT_KEY, { email: await fetchEmail() });
    return true;
  } catch (e) {
    return false;
  }
}

async function fetchEmail() {
  const res = await api('https://www.googleapis.com/oauth2/v2/userinfo');
  const data = await res.json();
  return data.email || '';
}

export function createWebCloud() {
  return {
    web: true,

    async status() {
      const account = read(ACCOUNT_KEY);
      const auth = tokenInfo();
      return {
        configured: true,
        loggedIn: Boolean(account && account.email),
        email: (account && account.email) || '',
        scopes: String((auth && auth.scope) || '').split(/\s+/).filter(Boolean),
        tokenValid: Boolean(validToken()),
        signInNeeded: null
      };
    },

    async login(_lang, { calendar = false } = {}) {
      const result = await signInWindow({ calendar });
      if (!result.ok) return result;
      try {
        const email = await fetchEmail();
        write(ACCOUNT_KEY, { email });
        return { ok: true, email };
      } catch (e) {
        return { ok: false, error: e.message, offline: isNetworkError(e) };
      }
    },

    // A fresh hour of access for the same account.
    renew() {
      return this.login(null, { calendar: grants((tokenInfo() || {}).scope, CALENDAR_SCOPE) });
    },

    async cancelLogin() {
      write(PENDING_KEY, null);
      return { ok: true };
    },

    async logout() {
      const auth = tokenInfo();
      write(AUTH_KEY, null);
      write(ACCOUNT_KEY, null);
      if (auth && auth.accessToken) {
        try {
          await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(auth.accessToken), {
            method: 'POST', mode: 'no-cors'
          });
        } catch (e) { /* offline: the local sign-out still stands */ }
      }
      return { ok: true };
    },

    async getState() {
      return read(STATE_KEY) || {};
    },

    async setState(patch) {
      write(STATE_KEY, { ...(read(STATE_KEY) || {}), ...patch });
      return { ok: true };
    },

    meta() {
      return guard(async () => {
        const q = encodeURIComponent(`name = '${REMOTE_NAME}' and trashed = false`);
        const res = await api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&fields=files(id,version,modifiedTime)`);
        const files = (await res.json()).files || [];
        if (!files.length) return { exists: false };
        return {
          exists: true,
          fileId: files[0].id,
          version: String(files[0].version),
          modifiedTime: files[0].modifiedTime,
          duplicates: files.slice(1).map(f => f.id)
        };
      });
    },

    download(fileId) {
      return guard(async () => {
        const meta = await (await api(`${DRIVE}/files/${fileId}?fields=id,version`)).json();
        const res = await api(`${DRIVE}/files/${fileId}?alt=media`, { timeout: 120000 });
        const content = await gunzip(await res.arrayBuffer());
        JSON.parse(content); // a damaged download must never reach the merge
        return { content, version: String(meta.version), fileId };
      });
    },

    upload(content, fileId = null) {
      return guard(async () => {
        if (typeof content !== 'string' || !content) throw new Error('empty_upload');
        JSON.parse(content);
        const body = await gzip(content);
        if (fileId) {
          try {
            const res = await api(`${UPLOAD}/files/${fileId}?uploadType=media&fields=id,version`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/gzip' }, body, timeout: 120000
            });
            const saved = await res.json();
            return { fileId: saved.id, version: String(saved.version) };
          } catch (e) {
            if (e.status !== 404) throw e;
            // The file was removed from the cloud: create it again below.
          }
        }
        const boundary = 'we-budget-' + randomState();
        const metadata = JSON.stringify({ name: REMOTE_NAME, parents: ['appDataFolder'], mimeType: 'application/gzip' });
        const multipart = new Blob([
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`,
          body,
          `\r\n--${boundary}--`
        ]);
        const res = await api(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, {
          method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart, timeout: 120000
        });
        const saved = await res.json();
        return { fileId: saved.id, version: String(saved.version) };
      });
    },

    remove(ids = []) {
      return guard(async () => {
        for (const id of ids) {
          await api(`${DRIVE}/files/${id}`, { method: 'DELETE' }).catch(() => null);
        }
        return {};
      });
    },

    calendar(method, path, query = null, body = null) {
      return guard(async () => {
        if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('bad_path');
        const qs = query ? '?' + new URLSearchParams(query).toString() : '';
        const res = await api(`${CALENDAR}${path}${qs}`, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined
        });
        const text = res.status === 204 ? '' : await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : null };
      });
    }
  };
}
