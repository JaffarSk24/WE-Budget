// Pure helpers of the updater, kept apart so they can be tested without
// Electron.

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
  if (!m) return null;
  return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null };
}

// 1 if a is newer, -1 if older, 0 if equal. A pre-release (1.2.0-beta.1)
// is older than the release it leads to.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] > pb.parts[i] ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre > pb.pre ? 1 : -1;
}

// Release assets are named WE-Budget-<version>-<os>-<arch>.<ext>.
// macOS prefers the zip (installed in place) for the running architecture;
// an Intel build still runs on Apple silicon, so it is the fallback.
function pickAsset(assets, platform, arch) {
  const list = (assets || []).filter(a => a && a.name && a.browser_download_url);
  const find = (re) => list.find(a => re.test(a.name));
  if (platform === 'darwin') {
    const zip = find(new RegExp(`-mac-${arch}\\.zip$`)) || find(/-mac-x64\.zip$/) || find(/-mac\.zip$/);
    const dmg = find(new RegExp(`-mac-${arch}\\.dmg$`)) || find(/-mac-x64\.dmg$/) || find(/\.dmg$/);
    return { install: zip || null, manual: dmg || null };
  }
  if (platform === 'win32') {
    const exe = find(new RegExp(`-win-${arch}\\.exe$`)) || find(/-win-x64\.exe$/) || find(/\.exe$/);
    return { install: exe || null, manual: exe || null };
  }
  return { install: null, manual: null };
}

function checksumsAsset(assets, platform) {
  const name = platform === 'darwin' ? 'latest-mac.yml' : platform === 'win32' ? 'latest.yml' : null;
  return (assets || []).find(a => a && a.name === name) || null;
}

// electron-builder writes latest-mac.yml / latest.yml with a sha512 (base64)
// for every file of the release. Only the `files:` list is needed here.
function parseChecksums(yml) {
  const result = {};
  let current = null;
  String(yml || '').split(/\r?\n/).forEach(line => {
    const url = /^\s*-\s*url:\s*(.+?)\s*$/.exec(line);
    if (url) {
      current = url[1].replace(/^['"]|['"]$/g, '');
      result[current] = {};
      return;
    }
    const field = /^\s+(sha512|size):\s*(.+?)\s*$/.exec(line);
    if (current && field) {
      result[current][field[1]] = field[1] === 'size' ? Number(field[2]) : field[2].replace(/^['"]|['"]$/g, '');
      return;
    }
    if (/^\S/.test(line)) current = null;
  });
  return result;
}

module.exports = { compareVersions, parseVersion, pickAsset, checksumsAsset, parseChecksums };
