const { app, BrowserWindow, ipcMain, protocol, shell, screen, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const cloud = require('./main/cloud.cjs');
const updater = require('./main/updater.cjs');

let viteProcess = null;
let mainWindow = null;
let lastUrl = null;
let mainWindowHasOpened = false;
// Closing waits for the page to push unsent changes to the cloud, at most
// this long; a slow network must never trap the user in an app that will
// not close. Anything not sent stays local and goes up on the next start.
const CLOSE_SYNC_TIMEOUT_MS = 8000;
let closeAllowed = false;
let closeRequested = false;

const APP_NAME = 'WE Budget';
const DEV_PORT = 3010;

// One data folder for every way of starting the app. Without this the dev
// run (named after package.json) and the installed app (named after the
// product) would each keep their own budget.
app.setPath('userData', process.env.WE_BUDGET_USER_DATA || path.join(app.getPath('appData'), APP_NAME));

// Custom app:// scheme instead of a local HTTP server: a stable origin and no
// open port.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// --- File-based data storage ---
// The JSON file in userData survives reinstalls and updates.
const dataFilePath = () => path.join(app.getPath('userData'), 'we-budget-data.json');
const backupsDir = () => path.join(app.getPath('userData'), 'backups');
const BACKUPS_TO_KEEP = 14;

// Local calendar day: a UTC date would roll over at 22:00 or 23:00 in
// Central Europe and the evening's backup would take the next day's name.
function localDayStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${localDayStamp(date)}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

// Once a day, before the first overwrite, keep a copy of the current file.
function makeDailyBackup() {
  try {
    const src = dataFilePath();
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(backupsDir(), { recursive: true });
    const dest = path.join(backupsDir(), `we-budget-data-${localDayStamp()}.json`);
    if (fs.existsSync(dest)) return;
    fs.copyFileSync(src, dest);
    const daily = fs.readdirSync(backupsDir())
      .filter(f => /^we-budget-data-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    while (daily.length > BACKUPS_TO_KEEP) {
      fs.unlinkSync(path.join(backupsDir(), daily.shift()));
    }
  } catch (e) {
    console.error('Backup failed:', e);
  }
}

// A copy that is never rotated away, taken before the whole document is
// replaced (restore from file, import, demo).
function snapshotDataFile(tag) {
  try {
    const src = dataFilePath();
    if (!fs.existsSync(src)) return null;
    fs.mkdirSync(backupsDir(), { recursive: true });
    const dest = path.join(backupsDir(), `we-budget-data-${tag}-${localTimeStamp()}.json`);
    fs.copyFileSync(src, dest);
    return dest;
  } catch (e) {
    console.error('Snapshot failed:', e);
    return null;
  }
}

function saveDataFile(json) {
  makeDailyBackup();
  // Atomic write: a temp file first, then rename over the real one.
  const tmp = dataFilePath() + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, dataFilePath());
}

function looksLikeFullReplace(prevJson, nextJson) {
  try {
    const prev = JSON.parse(prevJson);
    const next = JSON.parse(nextJson);
    const ids = (d) => new Set([...(d.entries || []), ...(d.accounts || [])].map(r => r.id));
    const before = ids(prev);
    if (before.size < 20) return false;
    const after = ids(next);
    let kept = 0;
    before.forEach(id => { if (after.has(id)) kept++; });
    return kept < before.size / 2;
  } catch (e) {
    return false;
  }
}

function initStorageIpc() {
  ipcMain.on('storage:load', (event) => {
    try {
      event.returnValue = fs.readFileSync(dataFilePath(), 'utf8');
    } catch (e) {
      event.returnValue = null;
    }
  });

  ipcMain.on('storage:save', (_event, json) => {
    if (typeof json !== 'string' || !json) return;
    try {
      // When most records are about to disappear at once (a restore, an
      // import, the demo), keep the old file under its own name first.
      let prev = null;
      try { prev = fs.readFileSync(dataFilePath(), 'utf8'); } catch (e) { /* first save */ }
      if (prev && looksLikeFullReplace(prev, json)) snapshotDataFile('before-replace');
      saveDataFile(json);
    } catch (e) {
      console.error('Failed to save data file:', e);
    }
  });

  ipcMain.handle('storage:open-backups', async () => {
    fs.mkdirSync(backupsDir(), { recursive: true });
    await shell.openPath(backupsDir());
    return backupsDir();
  });
}

// --- Cloud sync transport and updates ---
function initCloudIpc() {
  cloud.init();
  ipcMain.handle('cloud:status', () => cloud.status());
  ipcMain.handle('cloud:login', (_e, lang) => cloud.login(lang));
  ipcMain.handle('cloud:cancel-login', () => { cloud.cancelLogin(); return { ok: true }; });
  ipcMain.handle('cloud:logout', () => cloud.logout());
  ipcMain.handle('cloud:get-state', () => cloud.getState());
  ipcMain.handle('cloud:set-state', (_e, patch) => cloud.setState(patch || {}));
  ipcMain.handle('cloud:meta', () => cloud.meta());
  ipcMain.handle('cloud:download', (_e, fileId) => cloud.download(fileId));
  ipcMain.handle('cloud:upload', (_e, content, fileId) => cloud.upload(content, fileId));
  ipcMain.handle('cloud:remove', (_e, ids) => cloud.remove(ids));
}

function initUpdatesIpc() {
  updater.cleanup();
  ipcMain.handle('updates:check', () => updater.check());
  ipcMain.handle('updates:download', () => updater.download((p) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:progress', p);
  }));
  ipcMain.handle('updates:install', () => {
    const result = updater.install();
    // Quitting goes through the normal close path, so unsent changes reach
    // the cloud before the new version replaces this one.
    if (result.ok && result.quit) setTimeout(() => app.quit(), 100);
    return result;
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    canInstallUpdates: updater.canInstallInPlace()
  }));
}

// --- Serve the built app via app:// (dist only) ---
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

function registerAppProtocol() {
  const distRoot = path.join(__dirname, 'dist');
  protocol.handle('app', (request) => {
    try {
      const u = new URL(request.url);
      let pathname = decodeURIComponent(u.pathname);
      if (!pathname || pathname === '/') pathname = '/index.html';
      let file = path.normalize(path.join(distRoot, pathname));
      if (file !== distRoot && !file.startsWith(distRoot + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(file)) file = path.join(distRoot, 'index.html');
      const data = fs.readFileSync(file);
      const mime = MIME[path.extname(file)] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': mime } });
    } catch (e) {
      console.error('app:// handler error:', e);
      return new Response('Internal error', { status: 500 });
    }
  });
}

// macOS needs an application menu for the standard editing shortcuts
// (copy, paste, undo) to reach text fields.
function buildAppMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]));
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else if (lastUrl) {
    createWindow(lastUrl);
  }
}

function createWindow(url) {
  lastUrl = url;
  const { workArea } = screen.getPrimaryDisplay();
  mainWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    minWidth: 1000,
    minHeight: 640,
    title: APP_NAME,
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#090b11',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // External links open in the default browser, never inside the app.
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        if (!navigationUrl.startsWith(`http://localhost:${DEV_PORT}`)) {
          event.preventDefault();
          shell.openExternal(navigationUrl);
        }
      }
    } catch (e) {
      console.error('Failed to parse URL in will-navigate:', e);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    try {
      const parsed = new URL(openUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') shell.openExternal(openUrl);
    } catch (e) {
      console.error('Failed to parse URL in setWindowOpenHandler:', e);
    }
    return { action: 'deny' };
  });

  mainWindowHasOpened = true;
  mainWindow.loadURL(url);

  // Before the window goes away the page gets a chance to upload unsent
  // changes. It answers app:close-ready; the timeout covers a page that
  // hangs or is gone.
  mainWindow.on('close', (event) => {
    if (closeAllowed || !cloud.isLoggedIn()) return;
    event.preventDefault();
    if (closeRequested) return;
    closeRequested = true;
    let timer = null;
    const proceed = () => {
      clearTimeout(timer);
      // A late answer must not let a future window skip this step.
      ipcMain.removeListener('app:close-ready', proceed);
      closeAllowed = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    };
    timer = setTimeout(proceed, CLOSE_SYNC_TIMEOUT_MS);
    ipcMain.on('app:close-ready', proceed);
    mainWindow.webContents.send('app:before-close');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    closeAllowed = false;
    closeRequested = false;
  });
}

// Waits for the Vite dev server instead of guessing how long it needs.
function waitForDevServer(url, attempts = 60) {
  return new Promise((resolve) => {
    const http = require('http');
    const tryOnce = (left) => {
      http.get(url, (res) => { res.resume(); resolve(true); })
        .on('error', () => {
          if (left <= 0) resolve(false);
          else setTimeout(() => tryOnce(left - 1), 250);
        });
    };
    tryOnce(attempts);
  });
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  initStorageIpc();
  initCloudIpc();
  initUpdatesIpc();
  buildAppMenu();
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'icon.png')));
  }

  if (process.env.NODE_ENV === 'development') {
    const devUrl = `http://localhost:${DEV_PORT}`;
    viteProcess = spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort'], { shell: true, stdio: 'inherit' });
    await waitForDevServer(devUrl);
    createWindow(devUrl);
  } else {
    registerAppProtocol();
    createWindow('app://bundle/index.html');
  }
});

app.on('activate', () => showMainWindow());

// The app has nothing to do without its window (no menu-bar part yet), so
// closing the window quits it on every platform.
app.on('window-all-closed', () => {
  if (mainWindowHasOpened) app.quit();
});

app.on('will-quit', () => {
  if (viteProcess) {
    try { viteProcess.kill(); } catch (e) { /* ignore */ }
  }
});

// By now the window is closed and unsent changes have gone up.
app.on('quit', () => updater.launchPendingInstaller());
