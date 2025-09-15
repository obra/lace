// ABOUTME: Vitest configuration for web package
// ABOUTME: Sets up test environment for Next.js components and API routes

import { defineConfig } from 'vitest/config';
import { plugin as markdown, Mode } from 'vite-plugin-markdown';
import path from 'path';

export default defineConfig({
  plugins: [markdown({ mode: [Mode.RAW] })],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './test-setup.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/app/routes/api.provider.instances.$instanceId.test.ts',
      '**/.react-router/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '~': path.resolve(__dirname, '../../packages/core/src'),
    },
  },
});
