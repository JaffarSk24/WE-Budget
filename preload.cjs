// Preload: the only bridge between the renderer and the main process.
// weStorage: the budget data file (userData/we-budget-data.json).
//
// Dropping weStorage silently sends the app back to localStorage, which is
// tied to the page origin and is not where the real data lives.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weStorage', {
  // Synchronous read at startup: the store initializes before the first render.
  load: () => ipcRenderer.sendSync('storage:load'),
  save: (json) => ipcRenderer.send('storage:save', json),
  backupsFolder: () => ipcRenderer.invoke('storage:open-backups')
});

contextBridge.exposeInMainWorld('wePlatform', {
  os: process.platform
});
