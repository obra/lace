// vite.config.ts
import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  plugins: [
    reactRouter({ ssr: false, prerender: false }),
    // Only use tsconfigPaths in dev to avoid sourcemap issues in build
    ...(isDev ? [tsconfigPaths()] : []),
  ],
  build: {
    // Turn OFF sourcemaps so Rollup reports the raw, underlying error
    sourcemap: false,
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, '../core/src'),
      '@': resolve(__dirname, '.'),
    },
  },
  ssr: { noExternal: ['react-router'] },
  css: { postcss: './postcss.config.js' },
});
