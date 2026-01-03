import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@lace/ent-protocol': resolve(__dirname, 'src'),
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
