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
//   gzipped JSON, a few dozen kilobytes even with years of history.

const { app, shell } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REMOTE_NAME = 'we-budget-data.json.gz';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TIMEOUT_MS = 30000;

const PAGE_TEXT = {
  ru: {
    okTitle: 'Готово',
    ok: 'Google-аккаунт подключён. Эту вкладку можно закрыть и вернуться в WE Budget.',
    failTitle: 'Не получилось',
    fail: 'Закройте вкладку и попробуйте войти ещё раз из приложения.'
  },
  en: {
    okTitle: 'Signed in',
    ok: 'Your Google account is connected. You can close this tab and return to WE Budget.',
    failTitle: 'Sign-in failed',
    fail: 'Close this tab and try again from the app.'
  }
};

function page(title, message, color) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0">
<div style="background:#1e293b;padding:40px;border-radius:16px;max-width:420px;text-align:center">
<h2 style="color:${color};margin:0 0 12px">${title}</h2>
<p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.5">${message}</p></div></body></html>`;
}

// Network failures look different on every platform; anything that is not
// an HTTP answer counts as "offline".
function isNetworkError(e) {
  return e && (e.name === 'TypeError' || e.name === 'AbortError' || e.name === 'TimeoutError'
    || /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(String(e.message)));
}

class Cloud {
  constructor() {
    this.credentials = null;
    this.tokens = null;
    this.tokensPath = null;
    this.statePath = null;
    this.server = null;
  }

  init() {
    const userData = app.getPath('userData');
    this.tokensPath = path.join(userData, 'google-tokens.json');
    this.statePath = path.join(userData, 'cloud-state.json');
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
      email: (this.tokens && this.tokens.email) || ''
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

  // ---------- OAuth ----------

  login(lang = 'en') {
    if (!this.isConfigured()) return Promise.resolve({ ok: false, error: 'not_configured' });
    if (this.server) {
      try { this.server.close(); } catch (e) { /* an earlier attempt */ }
      this.server = null;
    }
    const text = PAGE_TEXT[lang === 'ru' ? 'ru' : 'en'];
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
          res.end(page(text.failTitle, text.fail, '#f43f5e'));
          finish({ ok: false, error: error || 'invalid_response' });
          return;
        }
        const redirectUri = `http://127.0.0.1:${this.server.address().port}/callback`;
        try {
          const tokenData = await this.requestTokens({
            grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri
          });
          if (!tokenData.refresh_token) throw new Error('no_refresh_token');
          const email = await this.fetchEmail(tokenData.access_token);
          this.tokens = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expiry: Date.now() + (tokenData.expires_in || 3600) * 1000,
            email
          };
          this.writeJson(this.tokensPath, this.tokens);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page(text.okTitle, text.ok, '#22c55e'));
          finish({ ok: true, email });
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page(text.failTitle, text.fail, '#f43f5e'));
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
          scope: SCOPES,
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
  // access, or the OAuth app is in testing mode and the token is a week old.
  // Then a fresh sign-in is the only way forward.
  async accessToken({ force = false } = {}) {
    if (!this.isLoggedIn()) {
      const err = new Error('not_logged_in');
      err.reauth = true;
      throw err;
    }
    if (!force && this.tokens.access_token && Date.now() < this.tokens.expiry - 60000) {
      return this.tokens.access_token;
    }
    try {
      const fresh = await this.requestTokens({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token });
      this.tokens.access_token = fresh.access_token;
      this.tokens.expiry = Date.now() + (fresh.expires_in || 3600) * 1000;
      this.writeJson(this.tokensPath, this.tokens);
      return this.tokens.access_token;
    } catch (e) {
      if (e.code === 'invalid_grant' || e.code === 'unauthorized_client') {
        this.forgetTokens();
        const err = new Error('reauth_required');
        err.reauth = true;
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
        const err = new Error(`drive ${res.status}: ${body.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      return res;
    }
    throw new Error('unauthorized');
  }

  async listFiles() {
    const q = encodeURIComponent(`name = '${REMOTE_NAME}' and trashed = false`);
    const res = await this.api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&fields=files(id,version,modifiedTime)`);
    return (await res.json()).files || [];
  }

  // ---------- transport (all return { ok, ... } and never throw) ----------

  async guard(fn) {
    try {
      return { ok: true, ...(await fn()) };
    } catch (e) {
      return { ok: false, error: e.message, reauth: Boolean(e.reauth), offline: isNetworkError(e) };
    }
  }

  meta() {
    return this.guard(async () => {
      const files = await this.listFiles();
      if (!files.length) return { exists: false };
      // Two devices creating the file at the same moment leave two copies;
      // the most recently written one is the budget, the rest get removed.
      return {
        exists: true,
        fileId: files[0].id,
        version: String(files[0].version),
        modifiedTime: files[0].modifiedTime,
        duplicates: files.slice(1).map(f => f.id)
      };
    });
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

  upload(content, fileId = null) {
    return this.guard(async () => {
      if (typeof content !== 'string' || !content) throw new Error('empty_upload');
      JSON.parse(content);
      const body = zlib.gzipSync(Buffer.from(content, 'utf8'));
      if (fileId) {
        try {
          const res = await this.api(`${UPLOAD}/files/${fileId}?uploadType=media&fields=id,version`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/gzip' }, body, timeout: 120000
          });
          const saved = await res.json();
          return { fileId: saved.id, version: String(saved.version) };
        } catch (e) {
          if (e.status !== 404) throw e;
          // The file was removed from the cloud: create it again below.
        }
      }
      const boundary = 'we-budget-' + crypto.randomBytes(8).toString('hex');
      const metadata = JSON.stringify({ name: REMOTE_NAME, parents: ['appDataFolder'], mimeType: 'application/gzip' });
      const multipart = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`),
        body,
        Buffer.from(`\r\n--${boundary}--`)
      ]);
      const res = await this.api(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart, timeout: 120000
      });
      const saved = await res.json();
      return { fileId: saved.id, version: String(saved.version) };
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
    if (token) {
      // Best effort: tell Google to drop the grant too.
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
          signal: AbortSignal.timeout(10000)
        });
      } catch (e) { /* offline: the local sign-out still stands */ }
    }
    return { ok: true };
  }
}

module.exports = new Cloud();
