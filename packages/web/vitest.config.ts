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
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 2,
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
