// ABOUTME: Vitest configuration for web package
// ABOUTME: Sets up test environment for Next.js components and API routes

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './test-setup.ts',
    reporters: [['default', { summary: false }]],
    testTimeout: 30000,
    hookTimeout: 20000,
    // Use forks pool instead of threads for better cleanup/stability
    // See: https://github.com/vitest-dev/vitest/issues/2008
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 4,
      },
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/app/routes/api.provider.instances.$instanceId.test.ts',
      '**/.react-router/**',
    ],
  },
  resolve: {
    alias: {
      '@lace/web': path.resolve(__dirname, './'),
    },
  },
});
