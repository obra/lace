import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: './test-setup.ts',
    exclude: ['**/node_modules/**', '**/dist/**'],
    environmentMatchGlobs: [
      // Use jsdom for component and hook tests
      ['**/*.{test,spec}.{ts,tsx}', 'jsdom'],
      // Keep node environment for API route tests
      ['app/api/**/*.test.ts', 'node'],
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '~': path.resolve(__dirname, '../../src'),
    },
  },
});
