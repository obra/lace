// vite.config.ts
import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
  build: {
    sourcemap: false,
    rollupOptions: {
      onwarn(warning, warn) {
        // Skip sourcemap-related warnings - known Vite issue
        // See: https://github.com/vitejs/vite/issues/15012
        if (warning.code === 'SOURCEMAP_ERROR') {
          return;
        }
        warn(warning);
      },
    },
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
