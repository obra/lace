import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**', '**/.next/**', 'packages/**'],
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts'],
    },
    environment: 'jsdom', // Default to jsdom for React components
    setupFiles: ['./src/test-setup.ts'],
    env: {
      // Disable colors in test environment to ensure consistent output
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  },
  projects: [
    {
      // Main project (CLI tests)
      test: {
        include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
        exclude: ['packages/**'],
        environment: 'jsdom',
        setupFiles: ['./src/test-setup.ts'],
      },
    },
  ],
});
