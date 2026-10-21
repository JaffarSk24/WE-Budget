// Google sign-in and the Google Drive transport for sync.
//
// This module only moves bytes and keeps the tokens; merging two copies of
// the budget happens in the page (src/sync), the same code on every device.
//
// - The app ships with its own OAuth client (oauth-credentials.json, bundled
//   into the package but kept out of the repository). For installed apps the
//   client secret is not a secret: Google's documentation says so, it only
//   lets the app ask a user for consent.
// - Sign-in is the authorization code flow with PKCE and a loopback redirect
//   on a random local port, opened in the system browser.
// - The budget lives in the Drive appDataFolder: a hidden folder only this
//   app can read, which does not clutter the user's Drive. The file is
//   gzipped JSON, a few dozen kilobytes even with years of history. With
//   encryption on, the JSON is an envelope sealed in the page (src/sync/
//   crypto.js) and the file is named we-budget-data.enc.gz.

const { app, shell, safeStorage } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { signInPage } = require('./signin-page.cjs');
const { DRIVE_SCOPE, grantsDrive, isInsufficientScope, pendingSignIn, PLAIN_NAME, ENCRYPTED_NAME, pickMain } = require('./cloud-utils.cjs');

const SCOPES = [
  DRIVE_SCOPE,
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');
const DRIVE = 'https://www.googleapis.com/drive/v3';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
// Asked for only when reminders in Google Calendar are switched on.
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TIMEOUT_MS = 30000;

// Network failures look different on every platform; anything that is not
// an HTTP answer counts as "offline".
function isNetworkError(e) {
  return e && (e.name === 'TypeError' || e.name === 'AbortError' || e.name === 'TimeoutError'
    || /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(String(e.message)));
}

// Best effort: asks Google to drop a grant. Offline, the local sign-out
// still stands.
async function revoke(token) {
  if (!token) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) { /* offline */ }
}

class Cloud {
  constructor() {
    this.credentials = null;
    this.tokens = null;
    this.tokensPath = null;
    this.statePath = null;
    this.keyPath = null;
    this.server = null;
  }

  init() {
    const userData = app.getPath('userData');
    this.tokensPath = path.join(userData, 'google-tokens.json');
    this.statePath = path.join(userData, 'cloud-state.json');
    this.keyPath = path.join(userData, 'cloud-key.bin');
    // A client file in userData wins over the bundled one, so a build without
    // the bundled file can still be pointed at a client.
    const override = this.readJson(path.join(userData, 'google-credentials.json'));
    const bundled = this.readJson(path.join(__dirname, '..', 'oauth-credentials.json'));
    this.credentials = [override, bundled].find(c => c && c.clientId && c.clientSecret) || null;
    this.tokens = this.readJson(this.tokensPath);
  }

  readJson(file) {
    try {
      if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.error('[cloud] cannot read', path.basename(file), e.message);
    }
    return null;
  }

  // Tokens and sync state are readable by the owner only.
  writeJson(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  isConfigured() {
    return Boolean(this.credentials);
  }

  isLoggedIn() {
    return Boolean(this.tokens && this.tokens.refresh_token);
  }

  status() {
    return {
      configured: this.isConfigured(),
      loggedIn: this.isLoggedIn(),
      email: (this.tokens && this.tokens.email) || '',
      scopes: String((this.tokens && this.tokens.scope) || '').split(/\s+/).filter(Boolean),
      signInNeeded: pendingSignIn(this.getState(), this.isLoggedIn())
    };
  }

  // ---------- per-device sync state ----------

  getState() {
    return this.readJson(this.statePath) || {};
  }

  setState(patch) {
    const next = { ...this.getState(), ...patch };
    this.writeJson(this.statePath, next);
    return { ok: true };
  }

  // Sync was on and stopped because Google wants a new sign-in. Kept on
  // disk, so the app keeps asking after a restart until the owner signs in
  // again or turns sync off.
  markSignInNeeded(reason) {
    this.setState({ signInNeeded: { reason, email: (this.tokens && this.tokens.email) || '', at: new Date().toISOString() } });
  }

  // ---------- the encryption key of this device ----------
  //
  // The page derives the key from the password; only the derived key bits
  // come here, never the password. They are written sealed by the system
  // keychain (safeStorage) and never in plain text: when the keychain is not
  // usable (some Linux desktops fall back to a fixed key), nothing is
  // written and the page asks for the password once per session.

  keychainUsable() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
        return !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend());
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  getKey() {
    try {
      if (!this.keychainUsable() || !fs.existsSync(this.keyPath)) return { ok: true, value: null };
      return { ok: true, value: safeStorage.decryptString(fs.readFileSync(this.keyPath)) };
    } catch (e) {
      console.error('[cloud] cannot read the sync key', e.message);
      return { ok: true, value: null };
    }
  }

  setKey(value) {
    if (typeof value !== 'string' || !value || value.length > 10000) return { ok: false, stored: false };
    if (!this.keychainUsable()) return { ok: true, stored: false };
    try {
      const tmp = this.keyPath + '.tmp';
      fs.writeFileSync(tmp, safeStorage.encryptString(value), { mode: 0o600 });
      fs.renameSync(tmp, this.keyPath);
      return { ok: true, stored: true };
    } catch (e) {
      console.error('[cloud] cannot store the sync key', e.message);
      return { ok: true, stored: false };
    }
  }

  forgetKey() {
    try {
      if (fs.existsSync(this.keyPath)) fs.unlinkSync(this.keyPath);
    } catch (e) {
      console.error('[cloud] cannot remove the sync key', e.message);
    }
    return { ok: true };
  }

  // ---------- OAuth ----------

  // `calendar`: also ask for the app's own calendars (reminders). Scopes
  // granted earlier are kept (include_granted_scopes).
  login(lang = 'en', { calendar = false } = {}) {
    if (!this.isConfigured()) return Promise.resolve({ ok: false, error: 'not_configured' });
    if (this.server) {
      try { this.server.close(); } catch (e) { /* an earlier attempt */ }
      this.server = null;
    }
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try { if (this.server) this.server.close(); } catch (e) { /* already closed */ }
        this.server = null;
        resolve(result);
      };

      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        if (error || !code || url.searchParams.get('state') !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(signInPage(lang, 'fail'));
          finish({ ok: false, error: error || 'invalid_response' });
          return;
        }
        const redirectUri = `http://127.0.0.1:${this.server.address().port}/callback`;
        try {
          const tokenData = await this.requestTokens({
            grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri
          });
          if (!grantsDrive(tokenData.scope)) {
            // Google lets people untick single permissions. Without the
            // Drive one every sync would fail, so the sign-in is refused
            // here and the grant dropped.
            revoke(tokenData.refresh_token || tokenData.access_token);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(signInPage(lang, 'scope'));
            finish({ ok: false, error: 'drive_scope_missing' });
            return;
          }
          if (!tokenData.refresh_token) throw new Error('no_refresh_token');
          const email = await this.fetchEmail(tokenData.access_token);
          this.tokens = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expiry: Date.now() + (tokenData.expires_in || 3600) * 1000,
            email,
            clientId: this.credentials.clientId,
            scope: tokenData.scope || SCOPES
          };
          this.writeJson(this.tokensPath, this.tokens);
          this.setState({ signInNeeded: null });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(signInPage(lang, 'ok'));
          finish({ ok: true, email });
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(signInPage(lang, 'fail'));
          finish({ ok: false, error: e.message, offline: isNetworkError(e) });
        }
      });
      this.server.on('error', (e) => finish({ ok: false, error: e.message }));
      // Port 0: any free port; Google accepts any loopback port for desktop clients.
      this.server.listen(0, '127.0.0.1', () => {
        const redirectUri = `http://127.0.0.1:${this.server.address().port}/callback`;
        const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
          client_id: this.credentials.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: calendar ? `${SCOPES} ${CALENDAR_SCOPE}` : SCOPES,
          include_granted_scopes: 'true',
          access_type: 'offline',
          prompt: 'consent',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state
        }).toString();
        shell.openExternal(authUrl);
      });
      // A browser tab left open must not keep a local server alive forever.
      setTimeout(() => finish({ ok: false, error: 'timeout' }), 5 * 60 * 1000);
    });
  }

  cancelLogin() {
    if (this.server) {
      try { this.server.close(); } catch (e) { /* already closed */ }
      this.server = null;
    }
  }

  async requestTokens(params) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        ...params
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error_description || data.error || `token ${res.status}`);
      err.code = data.error;
      throw err;
    }
    return data;
  }

  async fetchEmail(accessToken) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      const data = await res.json();
      return data.email || '';
    } catch (e) {
      return '';
    }
  }

  forgetTokens() {
    this.tokens = null;
    try {
      if (fs.existsSync(this.tokensPath)) fs.unlinkSync(this.tokensPath);
    } catch (e) {
      console.error('[cloud] cannot remove tokens', e.message);
    }
  }

  // Google may stop honouring a refresh token at any time: the user revoked
  // access, or the token was issued to another OAuth client (an older version
  // of the app). Then a fresh sign-in is the only way forward.
  async accessToken({ force = false } = {}) {
    if (!this.isLoggedIn()) {
      const err = new Error('not_logged_in');
      err.reauth = true;
      throw err;
    }
    // Tokens belong to the OAuth client that issued them, and the hidden
    // Drive folder belongs to that client's project. Tokens saved under
    // another client (or before tokens recorded their client) go through a
    // refresh first: Google refuses it for a different client, and the app
    // asks for a new sign-in instead of working with the old client's folder.
    const sameClient = Boolean(this.credentials) && this.tokens.clientId === this.credentials.clientId;
    if (!force && sameClient && this.tokens.access_token && Date.now() < this.tokens.expiry - 60000) {
      return this.tokens.access_token;
    }
    try {
      const fresh = await this.requestTokens({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token });
      this.tokens.access_token = fresh.access_token;
      if (fresh.scope) this.tokens.scope = fresh.scope;
      this.tokens.expiry = Date.now() + (fresh.expires_in || 3600) * 1000;
      this.tokens.clientId = this.credentials.clientId;
      this.writeJson(this.tokensPath, this.tokens);
      return this.tokens.access_token;
    } catch (e) {
      if (e.code === 'invalid_grant' || e.code === 'unauthorized_client') {
        this.markSignInNeeded('expired');
        this.forgetTokens();
        const err = new Error('reauth_required');
        err.reauth = true;
        err.reason = 'expired';
        throw err;
      }
      throw e;
    }
  }

  // Authorized request with one retry after a 401 (an access token can be
  // revoked before its expiry time).
  async api(url, options = {}) {
    let token = await this.accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(options.timeout || TIMEOUT_MS)
      });
      if (res.status === 401 && attempt === 0) {
        token = await this.accessToken({ force: true });
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (isInsufficientScope(res.status, body) && options.calendar) {
          // Calendar access not granted (yet): reminders need their own
          // consent, the Drive sign-in stays.
          const err = new Error('calendar_scope_missing');
          err.status = 403;
          err.scopeMissing = true;
          throw err;
        }
        if (isInsufficientScope(res.status, body)) {
          // Signed in without the Drive permission (possible before the
          // app checked it at sign-in): only a new sign-in helps.
          this.markSignInNeeded('drive_scope');
          this.forgetTokens();
          const err = new Error('drive_scope_missing');
          err.reauth = true;
          err.reason = 'drive_scope';
          throw err;
        }
        const err = new Error(`drive ${res.status}: ${body.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      return res;
    }
    throw new Error('unauthorized');
  }

  async listFiles() {
    const q = encodeURIComponent(`(name = '${PLAIN_NAME}' or name = '${ENCRYPTED_NAME}') and trashed = false`);
    const res = await this.api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&fields=files(id,name,version,modifiedTime)`);
    return (await res.json()).files || [];
  }

  // ---------- transport (all return { ok, ... } and never throw) ----------

  async guard(fn) {
    try {
      return { ok: true, ...(await fn()) };
    } catch (e) {
      return {
        ok: false, error: e.message, reauth: Boolean(e.reauth), reason: e.reason || null,
        status: e.status || null, scopeMissing: Boolean(e.scopeMissing), offline: isNetworkError(e)
      };
    }
  }

  meta() {
    // Two devices creating the file at the same moment leave two copies;
    // the most recently written one is the budget (an encrypted one first),
    // the rest are merged in and removed by the engine.
    return this.guard(async () => pickMain(await this.listFiles()));
  }

  download(fileId) {
    return this.guard(async () => {
      const meta = await (await this.api(`${DRIVE}/files/${fileId}?fields=id,version`)).json();
      const res = await this.api(`${DRIVE}/files/${fileId}?alt=media`, { timeout: 120000 });
      const raw = Buffer.from(await res.arrayBuffer());
      const content = zlib.gunzipSync(raw).toString('utf8');
      JSON.parse(content); // a damaged download must never reach the merge
      return { content, version: String(meta.version), fileId };
    });
  }

  // `encrypted`: the content is an encryption envelope, stored under the
  // encrypted name. Writing over an existing file also sets its name, so
  // turning encryption on or off renames the one file in the same request
  // and there is never a moment with two budgets in the cloud.
  upload(content, fileId = null, encrypted = false) {
    return this.guard(async () => {
      if (typeof content !== 'string' || !content) throw new Error('empty_upload');
      JSON.parse(content);
      const body = zlib.gzipSync(Buffer.from(content, 'utf8'));
      const name = encrypted ? ENCRYPTED_NAME : PLAIN_NAME;
      const multipart = (metadata) => {
        const boundary = 'we-budget-' + crypto.randomBytes(8).toString('hex');
        return {
          boundary,
          body: Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`),
            body,
            Buffer.from(`\r\n--${boundary}--`)
          ])
        };
      };
      if (fileId) {
        try {
          const part = multipart({ name });
          const res = await this.api(`${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id,version`, {
            method: 'PATCH', headers: { 'Content-Type': `multipart/related; boundary=${part.boundary}` }, body: part.body, timeout: 120000
          });
          const saved = await res.json();
          return { fileId: saved.id, version: String(saved.version) };
        } catch (e) {
          if (e.status !== 404) throw e;
          // The file was removed from the cloud: create it again below.
        }
      }
      const part = multipart({ name, parents: ['appDataFolder'], mimeType: 'application/gzip' });
      const res = await this.api(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${part.boundary}` }, body: part.body, timeout: 120000
      });
      const saved = await res.json();
      return { fileId: saved.id, version: String(saved.version) };
    });
  }

  // Google Calendar request for reminders: path under /calendar/v3, query
  // parameters and an optional JSON body. Returns { status, json }.
  calendar(method, path, query = null, body = null) {
    return this.guard(async () => {
      if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('bad_path');
      const qs = query ? '?' + new URLSearchParams(query).toString() : '';
      const res = await this.api(`${CALENDAR}${path}${qs}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        calendar: true
      });
      const text = res.status === 204 ? '' : await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    });
  }

  remove(ids = []) {
    return this.guard(async () => {
      for (const id of ids) {
        await this.api(`${DRIVE}/files/${id}`, { method: 'DELETE' }).catch(() => null);
      }
      return {};
    });
  }

  async logout() {
    const token = this.tokens && (this.tokens.refresh_token || this.tokens.access_token);
    this.forgetTokens();
    // Turning sync off is a decision, not a failure: nothing to ask about.
    this.setState({ signInNeeded: null });
    await revoke(token);
    return { ok: true };
  }
}

module.exports = new Cloud();
