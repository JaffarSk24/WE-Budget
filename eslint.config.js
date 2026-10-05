import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  FileReader: 'readonly',
  Intl: 'readonly',
  globalThis: 'readonly',
  getComputedStyle: 'readonly',
  KeyboardEvent: 'readonly',
  HTMLElement: 'readonly',
  Node: 'readonly',
  HashChangeEvent: 'readonly',
  __APP_VERSION__: 'readonly'
};

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browserGlobals },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }] }
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { process: 'readonly', console: 'readonly' } }
  },
  {
    files: ['electron-main.cjs', 'preload.cjs', 'main/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', process: 'readonly', console: 'readonly',
        __dirname: 'readonly', setTimeout: 'readonly', setInterval: 'readonly', clearTimeout: 'readonly',
        clearInterval: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Buffer: 'readonly',
        Response: 'readonly', fetch: 'readonly', AbortSignal: 'readonly'
      }
    },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }] }
  },
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'node_modules.nosync/**', 'private/**']
  }
];
