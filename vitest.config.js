import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('test')
  },
  test: {
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js']
  }
});
