// electron-builder afterPack hook: ad-hoc code signing for macOS builds.
// Without a paid Apple Developer ID, notarization is unavailable, but ad-hoc
// signing gives the app a valid local signature instead of none at all.
const { execSync } = require('child_process');
const path = require('path');

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  console.log(`  • ad-hoc signing ${appName}`);
  // codesign refuses to sign files with extended attributes ("detritus")
  execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  execSync(`codesign --verify --deep "${appPath}"`, { stdio: 'inherit' });
};
