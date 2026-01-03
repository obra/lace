import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@lace/agent': resolve(__dirname, 'src'),
      '@lace/ent-protocol': resolve(__dirname, '../ent-protocol/src'),
      '@lace/core': resolve(__dirname, '../core/src'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**', '**/.git/**'],
    environment: 'node',
    env: {
      NO_COLOR: '1',
      NODE_ENV: 'test',
    },
    testTimeout: 30000,
    hookTimeout: 10000,
  },
});
