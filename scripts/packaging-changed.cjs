// Tells CI whether a push changes what goes into the Windows installer or
// runs in the app's main process, so that the Windows install check runs
// only then. Interface changes cannot break the installation. A new version
// number alone does not count either: every release changes it, and the
// published installer of each release is checked by release-check.yml.
//
//   node scripts/packaging-changed.cjs <commit before the push> <commit after>
//
// Prints packaging=true or packaging=false for $GITHUB_OUTPUT.

const { execFileSync } = require('child_process');

// Files that go into the installer, run in the main process or make up the
// check itself.
const PACKAGING = [
  /^electron-main\.cjs$/,
  /^preload\.cjs$/,
  /^main\//,
  /^assets\//,
  /^icon\.png$/,
  /^scripts\/adhoc-sign\.cjs$/,
  /^scripts\/check-windows-install\.ps1$/,
  /^\.github\/workflows\/windows-install\.yml$/
];
const MANIFESTS = ['package.json', 'package-lock.json'];

function withoutVersion(text) {
  if (text == null) return null;
  const json = JSON.parse(text);
  delete json.version;
  if (json.packages && json.packages['']) delete json.packages[''].version;
  return JSON.stringify(json);
}

// `changed` lists the paths the push touches; `read(which, file)` gives the
// text of a file 'before' or 'after' the push, or null.
function packagingChanged(changed, read) {
  if (changed.some(file => PACKAGING.some(p => p.test(file)))) return true;
  return MANIFESTS.some(file => changed.includes(file)
    && withoutVersion(read('before', file)) !== withoutVersion(read('after', file)));
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function changedSince(before, after) {
  // A new branch has no commit before the push: check it.
  if (!before || /^0+$/.test(before)) return true;
  let changed;
  try {
    changed = git(['diff', '--name-only', before, after]).split('\n').filter(Boolean);
  } catch {
    return true;
  }
  const commits = { before, after };
  return packagingChanged(changed, (which, file) => {
    try {
      return git(['show', `${commits[which]}:${file}`]);
    } catch {
      return null;
    }
  });
}

if (require.main === module) {
  const [before, after = 'HEAD'] = process.argv.slice(2);
  console.log(`packaging=${changedSince(before, after)}`);
}

module.exports = { packagingChanged, withoutVersion };
