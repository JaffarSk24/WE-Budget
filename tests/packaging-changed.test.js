import { describe, it, expect } from 'vitest';
import { packagingChanged } from '../scripts/packaging-changed.cjs';

const pkg = (version, devDependencies = {}) => JSON.stringify({ name: 'we-budget', version, devDependencies }, null, 2);
const lock = (version) => JSON.stringify({ name: 'we-budget', version, lockfileVersion: 3, packages: { '': { name: 'we-budget', version } } }, null, 2);
const reader = (before, after) => (which, file) => (which === 'before' ? before : after)[file] ?? null;

describe('which pushes need the Windows install check', () => {
  it('skips interface changes and a new version number', () => {
    expect(packagingChanged(['src/style.css', 'src/views/month.js', 'README.md'], reader({}, {}))).toBe(false);
    expect(packagingChanged(['package.json', 'package-lock.json'], reader(
      { 'package.json': pkg('1.1.1'), 'package-lock.json': lock('1.1.1') },
      { 'package.json': pkg('1.1.2'), 'package-lock.json': lock('1.1.2') }))).toBe(false);
  });

  it('runs for the main process, packaged files, dependencies and the check itself', () => {
    ['electron-main.cjs', 'preload.cjs', 'main/cloud.cjs', 'assets/trayTemplate.png', 'icon.png',
      'scripts/check-windows-install.ps1', '.github/workflows/windows-install.yml'].forEach(file =>
      expect(packagingChanged([file], reader({}, {}))).toBe(true));
    expect(packagingChanged(['package.json'], reader(
      { 'package.json': pkg('1.1.1', { 'electron-builder': '^24.13.3' }) },
      { 'package.json': pkg('1.1.1', { 'electron-builder': '^24.14.0' }) }))).toBe(true);
  });
});
