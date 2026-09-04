import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

/**
 * Frontend tests run against a DOM, with every API call mocked.
 *
 * Nothing here reaches a backend: the tests own the responses, so they assert
 * on what the interface does with a given answer — including the failures and
 * the slow ones — without a server running or a paid call being made.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
  },
});
