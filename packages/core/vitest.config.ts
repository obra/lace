// ABOUTME: Vitest configuration for @lace/core; sets up alias (~), Node test env, coverage, and setup files
// ABOUTME: Configures test environment, path aliases, and coverage settings for the core package
import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**', '**/.git/**'],
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/setup.*',
        '**/setup/**',
        '**/.git/worktrees/**',
        '**/.worktree/**',
      ],
    },
    environment: 'node',
    setupFiles: [resolve(__dirname, 'src/test-setup.ts')],
    env: {
      NO_COLOR: '1',
    },
  },
});
