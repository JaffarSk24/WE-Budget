// Renders assets/icon.svg into the PNG files the app and its installers use.
// Run with Electron so the drawing goes through the same Chromium renderer:
//   npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');

// The desktop icon is a rounded tile with a margin and a shadow, as macOS
// wants it. A phone cuts its own rounded shape out of a full square and
// fills transparent corners with white or black, so the phone icons are the
// same drawing on a full-bleed background, without the tile's shadow.
// `scale` enlarges the drawing to the size it has inside the tile; the
// maskable icon for Android keeps it smaller, inside the safe circle.
function phoneSvg(scale) {
  const TILE = /<rect x="100" y="100" width="824" height="824" rx="185" fill="#2e354f" filter="url\(#tile-shadow\)"\/>\s*<rect x="100" y="100" width="824" height="824" rx="185" fill="url\(#tile-light\)"\/>/;
  if (!TILE.test(svg)) throw new Error('assets/icon.svg changed: the tile rectangles were not found');
  const [head, rest] = svg.split(TILE);
  const body = rest.replace(/<\/svg>\s*$/, '');
  return `${head}<rect width="1024" height="1024" fill="#2e354f"/><rect width="1024" height="1024" fill="url(#tile-light)"/>`
    + `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${body}</g></svg>`;
}

const DESKTOP = [
  { file: 'icon.png', size: 1024, svg },
  { file: path.join('public', 'favicon.png'), size: 128, svg }
];
const PHONE = [
  { file: path.join('public', 'apple-touch-icon.png'), size: 180, svg: phoneSvg(1.12) },
  { file: path.join('public', 'icon-192.png'), size: 192, svg: phoneSvg(1.12) },
  { file: path.join('public', 'icon-512.png'), size: 512, svg: phoneSvg(1.12) },
  { file: path.join('public', 'icon-maskable-512.png'), size: 512, svg: phoneSvg(1) }
];
// `--phone` renders only the phone icons (the desktop ones go into the
// installers, and redrawing them changes their bytes for nothing).
const OUTPUTS = process.argv.includes('--phone') ? PHONE : DESKTOP.concat(PHONE);

app.disableHardwareAcceleration();
// Retina screens would otherwise double every pixel size.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// Windows are created and destroyed one by one; closing the last of them
// must not end the run.
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const { file, size, svg: source } of OUTPUTS) {
    const win = new BrowserWindow({
      width: size, height: size, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', webPreferences: { offscreen: true }
    });
    const sized = source.replace('width="1024" height="1024"', `width="${size}" height="${size}"`);
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
