import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
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
    setupFiles: ['./src/test/setup.ts'],
    environmentMatchGlobs: [
      // PTY and CLI tests need node environment with TTY setup
      [
        '**/*{pty,cli,e2e}*',
        {
          environment: 'node',
          setupFiles: ['./src/test/setup.ts', './src/__tests__/setup-tty.js'],
        },
      ],
      // React component tests need jsdom environment
      ['**/*.{tsx,jsx}', { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] }],
    ],
  },
});
