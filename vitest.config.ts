/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    include: [
      '@fortawesome/react-fontawesome',
      '@fortawesome/fontawesome-svg-core',
      '@fortawesome/free-solid-svg-icons',
      '@storybook/addon-a11y/preview',
      '@storybook/nextjs-vite',
      '@testing-library/react',
      'framer-motion',
      'react',
      'react-dom',
    ],
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
    environment: 'jsdom',
    // Default to jsdom for React components
    setupFiles: ['./src/__tests__/setup.ts'],
    projects: [
      // Regular Vitest project for unit tests
      {
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./src/__tests__/setup.ts'],
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['**/*.stories.{ts,tsx}'],
        },
      },
      // Storybook test project
      {
        plugins: [
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: 'playwright',
            instances: [
              {
                browser: 'chromium',
              },
            ],
          },
          include: ['**/*.stories.{ts,tsx}'],
          setupFiles: ['.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
});
