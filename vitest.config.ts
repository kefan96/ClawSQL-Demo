import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration and E2E tests are skipped by default via describe.skip in the test files
    // They can be enabled by setting RUN_INTEGRATION_TESTS=true or RUN_E2E_TESTS=true
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: ['node_modules/', 'tests/', 'dist/'],
    },
    timeout: 60000,
    setupFiles: ['tests/helpers/setup.ts'],
  },
  resolve: {
    alias: [
      {
        find: /^(\.\.\/)+src\/(.+)\.js$/,
        replacement: resolve(__dirname, 'src/$2.ts'),
      },
    ],
  },
});