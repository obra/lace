// ABOUTME: Vitest configuration for @lace/core; sets up alias (~), Node test env, coverage, and setup files
// ABOUTME: Configures test environment, path aliases, and coverage settings for the core package
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts'],
    },
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
    env: {
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  },
});
