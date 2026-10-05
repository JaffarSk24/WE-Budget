import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compareVersions, pickAsset, checksumsAsset, parseChecksums } = require('../main/update-utils.cjs');

const asset = (name) => ({ name, browser_download_url: `https://example.com/${name}`, size: 100 });

describe('versions', () => {
  it('compares numerically, ignores the v prefix, puts pre-releases first', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '1.3.0')).toBe(-1);
    expect(compareVersions('1.3.0-beta.1', '1.3.0')).toBe(-1);
    expect(compareVersions('1.3.0', '1.3.0-beta.1')).toBe(1);
    expect(compareVersions('garbage', '1.0.0')).toBe(0);
  });
});

describe('release assets', () => {
  const assets = [
    asset('WE-Budget-0.2.0-mac-x64.zip'), asset('WE-Budget-0.2.0-mac-arm64.zip'),
    asset('WE-Budget-0.2.0-mac-x64.dmg'), asset('WE-Budget-0.2.0-mac-arm64.dmg'),
    asset('WE-Budget-0.2.0-win-x64.exe'), asset('latest-mac.yml'), asset('latest.yml')
  ];

  it('picks the build for the running CPU', () => {
    expect(pickAsset(assets, 'darwin', 'arm64').install.name).toBe('WE-Budget-0.2.0-mac-arm64.zip');
    expect(pickAsset(assets, 'darwin', 'x64').manual.name).toBe('WE-Budget-0.2.0-mac-x64.dmg');
    expect(pickAsset(assets, 'win32', 'x64').install.name).toBe('WE-Budget-0.2.0-win-x64.exe');
  });

  it('falls back to the Intel build on Apple silicon', () => {
    const intelOnly = assets.filter(a => !a.name.includes('arm64'));
    expect(pickAsset(intelOnly, 'darwin', 'arm64').install.name).toBe('WE-Budget-0.2.0-mac-x64.zip');
  });

  it('finds the checksum file per platform', () => {
    expect(checksumsAsset(assets, 'darwin').name).toBe('latest-mac.yml');
    expect(checksumsAsset(assets, 'win32').name).toBe('latest.yml');
  });

  it('reads sha512 and size of each file from latest-mac.yml', () => {
    const yml = [
      'version: 0.2.0',
      'files:',
      '  - url: WE-Budget-0.2.0-mac-x64.zip',
      '    sha512: AAA==',
      '    size: 123',
      '  - url: WE-Budget-0.2.0-mac-x64.dmg',
      '    sha512: BBB==',
      '    size: 456',
      'path: WE-Budget-0.2.0-mac-x64.zip',
      'sha512: AAA==',
      "releaseDate: '2026-10-05T10:00:00.000Z'"
    ].join('\n');
    expect(parseChecksums(yml)).toEqual({
      'WE-Budget-0.2.0-mac-x64.zip': { sha512: 'AAA==', size: 123 },
      'WE-Budget-0.2.0-mac-x64.dmg': { sha512: 'BBB==', size: 456 }
    });
  });
});
