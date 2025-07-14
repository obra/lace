import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
      '@': resolve(__dirname, 'packages/web'),
    },
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
      // ...other excludes
    ],
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts'],
    },
    environment: 'jsdom', // Default to jsdom for React components
    setupFiles: ['./src/__tests__/setup.ts'],
    env: {
      // Disable colors in test environment to ensure consistent output
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  },
});
