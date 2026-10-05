// Renders the menu-bar icon of macOS: the wallet of the app's icon set,
// black on transparent, as a template image (macOS recolours it for light
// and dark menu bars). Run with Electron:
//   npx electron scripts/render-tray-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// Lucide "wallet", the icon of the accounts screen.
const SHAPE = '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>';
const OUTPUTS = [
  { file: path.join('assets', 'trayTemplate.png'), size: 16, stroke: 1.8 },
  { file: path.join('assets', 'trayTemplate@2x.png'), size: 32, stroke: 1.8 }
];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const { file, size, stroke } of OUTPUTS) {
    const win = new BrowserWindow({
      width: size, height: size, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', webPreferences: { offscreen: true }
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${SHAPE}</svg>`;
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
    const tmp = path.join(app.getPath('temp'), `we-budget-tray-${size}.html`);
    fs.writeFileSync(tmp, html, 'utf8');
    await win.loadFile(tmp);
    await new Promise(r => setTimeout(r, 300));
    const captured = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const image = captured.getSize().width === size ? captured : captured.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(root, file), image.toPNG());
    console.log('wrote', file, image.getSize());
    win.destroy();
    fs.unlinkSync(tmp);
  }
  app.quit();
});
