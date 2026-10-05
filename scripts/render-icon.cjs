// Renders assets/icon.svg into the PNG files the app and its installers use.
// Run with Electron so the drawing goes through the same Chromium renderer:
//   npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
const OUTPUTS = [
  { file: 'icon.png', size: 1024 },
  { file: path.join('public', 'favicon.png'), size: 128 },
  { file: path.join('public', 'apple-touch-icon.png'), size: 180 }
];

app.disableHardwareAcceleration();
// Retina screens would otherwise double every pixel size.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// Windows are created and destroyed one by one; closing the last of them
// must not end the run.
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const { file, size } of OUTPUTS) {
    const win = new BrowserWindow({
      width: size, height: size, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', webPreferences: { offscreen: true }
    });
    const sized = svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`);
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${sized}</body></html>`;
    const tmp = path.join(app.getPath('temp'), `we-budget-icon-${size}.html`);
    fs.writeFileSync(tmp, html, 'utf8');
    await win.loadFile(tmp);
    await new Promise(r => setTimeout(r, 400));
    const captured = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const image = captured.getSize().width === size ? captured : captured.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(root, file), image.toPNG());
    console.log('wrote', file, image.getSize());
    win.destroy();
    fs.unlinkSync(tmp);
  }
  app.quit();
});
