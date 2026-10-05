// In-app updates from GitHub Releases.
//
// electron-updater cannot be used: on macOS it needs a paid Developer ID
// signature, and the app is only signed ad hoc. So the updater does the same
// job by hand:
//   - check the latest release and pick the file for this OS and CPU;
//   - download it, then verify size and the sha512 from the release's
//     latest-mac.yml / latest.yml;
//   - macOS: unpack the new .app and swap it in after the app quits, then
//     start it again. A download made by the app itself carries no quarantine
//     flag, so Gatekeeper does not stop the new version.
//   - Windows: once the app has quit (after its last sync), run the NSIS
//     installer silently with the flags electron-updater uses; it replaces
//     the installed copy and starts the app again. A download made by the
//     app carries no mark of the web, so SmartScreen does not stop it.
// When the app's own folder is not writable (for example an admin-owned
// /Applications), the downloaded disk image is opened instead and the user
// drags the app over as on first install.

const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { compareVersions, pickAsset, checksumsAsset, parseChecksums } = require('./update-utils.cjs');

const REPO = 'JaffarSk24/WE-Budget';
const DEFAULT_FEED = `https://api.github.com/repos/${REPO}/releases/latest`;
// A different feed (a local test server) can be given for testing the
// updater end to end. Only then are plain http links accepted.
const FEED = process.env.WE_BUDGET_UPDATE_FEED || DEFAULT_FEED;
const ALLOW_HTTP = Boolean(process.env.WE_BUDGET_UPDATE_FEED);
const USER_AGENT = 'WE-Budget-Updater';

let latest = null;
let downloaded = null;
// Windows installer waiting for the app to quit.
let pendingInstaller = null;

// --updated: an update of an installed copy (shortcuts stay as the user left
// them, the running app is closed without a question); /S: silent;
// --force-run: start the app when done.
const WINDOWS_UPDATE_ARGS = ['--updated', '/S', '--force-run'];

// A process that cannot start reports it as an 'error' event; unhandled, that
// event would show a crash dialog of the main process.
function launchDetached(file, args) {
  const child = spawn(file, args, { detached: true, stdio: 'ignore' });
  child.on('error', (e) => console.error('[updates] could not start', file, e.message));
  child.unref();
}

function updatesDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function safeUrl(url) {
  return typeof url === 'string' && (url.startsWith('https://') || (ALLOW_HTTP && url.startsWith('http://')));
}

async function check() {
  try {
    const res = await fetch(FEED, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000)
    });
    // No public release yet (or the repository is still private).
    if (res.status === 404) return { ok: true, available: false, current: app.getVersion(), noReleases: true };
    if (!res.ok) return { ok: false, error: `release feed ${res.status}` };
    const release = await res.json();
    const version = String(release.tag_name || release.name || '').replace(/^v/, '');
    const assets = pickAsset(release.assets, process.platform, process.arch);
    const sums = checksumsAsset(release.assets, process.platform);
    latest = { version, assets, sums, page: release.html_url || `https://github.com/${REPO}/releases/latest` };
    const newer = compareVersions(version, app.getVersion()) > 0;
    return {
      ok: true,
      current: app.getVersion(),
      latest: version,
      available: newer && Boolean(assets.install || assets.manual),
      notes: release.body || '',
      page: latest.page,
      canInstall: Boolean(assets.install) && canInstallInPlace(),
      size: (assets.install || assets.manual || {}).size || 0
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), offline: true };
  }
}

async function fetchChecksums() {
  if (!latest || !latest.sums || !safeUrl(latest.sums.browser_download_url)) return {};
  try {
    const res = await fetch(latest.sums.browser_download_url, {
      headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000)
    });
    return res.ok ? parseChecksums(await res.text()) : {};
  } catch (e) {
    return {};
  }
}

async function download(onProgress) {
  if (!latest) {
    const c = await check();
    if (!c.ok || !c.available) return { ok: false, error: 'no_update' };
  }
  const useInstall = latest.assets.install && canInstallInPlace();
  const asset = useInstall ? latest.assets.install : latest.assets.manual;
  if (!asset || !safeUrl(asset.browser_download_url)) return { ok: false, error: 'no_asset' };

  try {
    cleanup();
    fs.mkdirSync(updatesDir(), { recursive: true });
    const target = path.join(updatesDir(), asset.name);
    const partial = target + '.partial';
    const res = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(15 * 60 * 1000)
    });
    if (!res.ok || !res.body) return { ok: false, error: `download ${res.status}` };
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    const hash = crypto.createHash('sha512');
    const out = fs.createWriteStream(partial);
    let received = 0;
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk);
      hash.update(buf);
      received += buf.length;
      if (!out.write(buf)) await new Promise(r => out.once('drain', r));
      if (total && onProgress) onProgress(Math.min(1, received / total));
    }
    await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));

    if (asset.size && received !== asset.size) {
      fs.rmSync(partial, { force: true });
      return { ok: false, error: 'size_mismatch' };
    }
    const sums = await fetchChecksums();
    const expected = sums[asset.name] && sums[asset.name].sha512;
    if (expected && expected !== hash.digest('base64')) {
      fs.rmSync(partial, { force: true });
      return { ok: false, error: 'checksum_mismatch' };
    }
    fs.renameSync(partial, target);
    downloaded = { file: target, inPlace: Boolean(useInstall), version: latest.version };
    return { ok: true, inPlace: downloaded.inPlace, verified: Boolean(expected) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// /Applications/WE Budget.app/Contents/MacOS/WE Budget -> /Applications/WE Budget.app
function macBundlePath() {
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

function canInstallInPlace() {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return true;
  if (process.platform !== 'darwin') return false;
  const bundle = macBundlePath();
  if (!bundle) return false;
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    fs.accessSync(bundle, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

function prepareMacInstall(zipFile) {
  const bundle = macBundlePath();
  const stage = path.join(app.getPath('temp'), `we-budget-update-${Date.now()}`);
  fs.mkdirSync(stage, { recursive: true });
  const unzip = spawnSync('/usr/bin/ditto', ['-x', '-k', zipFile, stage]);
  if (unzip.status !== 0) throw new Error('unzip_failed');
  const appName = fs.readdirSync(stage).find(n => n.endsWith('.app'));
  if (!appName) throw new Error('no_app_in_zip');
  const fresh = path.join(stage, appName);
  const backup = path.join(app.getPath('temp'), `we-budget-previous-${Date.now()}.app`);
  const script = path.join(stage, 'install.sh');
  // Waits for this process to exit, swaps the bundles (rolling back if the
  // copy fails) and starts the app again.
  fs.writeFileSync(script, [
    '#!/bin/bash',
    'PID="$1"; TARGET="$2"; FRESH="$3"; BACKUP="$4"; STAGE="$5"',
    'for i in $(seq 1 300); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done',
    'if mv "$TARGET" "$BACKUP"; then',
    '  if /usr/bin/ditto "$FRESH" "$TARGET"; then rm -rf "$BACKUP"; else rm -rf "$TARGET"; mv "$BACKUP" "$TARGET"; fi',
    'fi',
    '/usr/bin/xattr -cr "$TARGET" 2>/dev/null',
    '/usr/bin/open "$TARGET"',
    'rm -rf "$STAGE"',
    ''
  ].join('\n'), { mode: 0o755 });
  return { script, args: [String(process.pid), bundle, fresh, backup, stage] };
}

// Starts the installation; the caller quits the app right after.
function install() {
  if (!downloaded || !fs.existsSync(downloaded.file)) return { ok: false, error: 'not_downloaded' };
  try {
    if (!downloaded.inPlace) {
      shell.openPath(downloaded.file);
      return { ok: true, quit: false, manual: true };
    }
    if (process.platform === 'darwin') {
      const { script, args } = prepareMacInstall(downloaded.file);
      launchDetached('/bin/bash', [script, ...args]);
      return { ok: true, quit: true };
    }
    if (process.platform === 'win32') {
      // Started from the quit event, not now: the installer closes a running
      // copy after a second or so, which could cut the last sync short.
      pendingInstaller = downloaded.file;
      return { ok: true, quit: true };
    }
    return { ok: false, error: 'unsupported_platform' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// Installers left from earlier updates only take space.
function cleanup() {
  try {
    if (!fs.existsSync(updatesDir())) return;
    fs.readdirSync(updatesDir()).forEach(name => {
      if (downloaded && path.join(updatesDir(), name) === downloaded.file) return;
      fs.rmSync(path.join(updatesDir(), name), { recursive: true, force: true });
    });
  } catch (e) {
    console.error('[updates] cleanup failed', e.message);
  }
}

// Called when the app quits: hands over to the Windows installer, if one is
// waiting.
function launchPendingInstaller() {
  if (!pendingInstaller) return;
  const file = pendingInstaller;
  pendingInstaller = null;
  launchDetached(file, WINDOWS_UPDATE_ARGS);
}

module.exports = { check, download, install, launchPendingInstaller, cleanup, canInstallInPlace };
