import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@lace/agent': resolve(__dirname, 'src'),
    },
  },
  test: {
    include: [
      'src/**/__tests__/**/*.{test,spec}.{ts,tsx}',
      'src/__tests__/**/*.{test,spec}.{ts,tsx}',
    ],
    environment: 'node',
    setupFiles: [],
  },
});
