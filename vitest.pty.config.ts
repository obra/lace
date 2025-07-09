import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*pty*.test.ts'],
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts', './src/__tests__/setup-tty.js'],
  },
});
