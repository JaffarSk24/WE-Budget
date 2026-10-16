// Preload: the only bridge between the renderer and the main process.
//   weStorage  the budget data file (userData/we-budget-data.json)
//   weCloud    Google sign-in and the Drive transport used by sync
//   weUpdates  update check, download and install
//   weApp      app info and the close handshake
//   wePlatform the operating system
//
// Dropping weStorage silently sends the app back to localStorage, which is
// tied to the page origin and is not where the real data lives.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weStorage', {
  // Synchronous read at startup: the store initializes before the first render.
  load: () => ipcRenderer.sendSync('storage:load'),
  save: (json) => ipcRenderer.send('storage:save', json),
  backupsFolder: () => ipcRenderer.invoke('storage:open-backups'),
  keepCopy: (tag, json) => ipcRenderer.send('storage:keep-copy', tag, json)
});

contextBridge.exposeInMainWorld('weCloud', {
  status: () => ipcRenderer.invoke('cloud:status'),
  login: (lang, opts) => ipcRenderer.invoke('cloud:login', lang, opts),
  cancelLogin: () => ipcRenderer.invoke('cloud:cancel-login'),
  logout: () => ipcRenderer.invoke('cloud:logout'),
  getState: () => ipcRenderer.invoke('cloud:get-state'),
  setState: (patch) => ipcRenderer.invoke('cloud:set-state', patch),
  meta: () => ipcRenderer.invoke('cloud:meta'),
  download: (fileId) => ipcRenderer.invoke('cloud:download', fileId),
  upload: (content, fileId, encrypted) => ipcRenderer.invoke('cloud:upload', content, fileId, encrypted),
  // The encryption key of this device, kept sealed by the system keychain.
  getKey: () => ipcRenderer.invoke('cloud:get-key'),
  setKey: (value) => ipcRenderer.invoke('cloud:set-key', value),
  forgetKey: () => ipcRenderer.invoke('cloud:forget-key'),
  remove: (ids) => ipcRenderer.invoke('cloud:remove', ids),
  calendar: (method, path, query, body) => ipcRenderer.invoke('cloud:calendar', method, path, query, body)
});

contextBridge.exposeInMainWorld('weUpdates', {
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  onProgress: (callback) => ipcRenderer.on('updates:progress', (_e, p) => callback(p))
});

contextBridge.exposeInMainWorld('weApp', {
  info: () => ipcRenderer.invoke('app:info'),
  onBeforeClose: (callback) => ipcRenderer.on('app:before-close', () => callback()),
  closeReady: () => ipcRenderer.send('app:close-ready'),
  setTray: (state) => ipcRenderer.send('app:tray', state),
  onQuickExpense: (callback) => ipcRenderer.on('app:quick-expense', () => callback())
});

contextBridge.exposeInMainWorld('wePlatform', {
  os: process.platform
});
