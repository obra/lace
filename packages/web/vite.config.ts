// ABOUTME: Vite configuration for React Router v7 Framework Mode
// ABOUTME: Configures SPA mode, path aliases, and API proxy for development

import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    reactRouter({
      ssr: false,
      prerender: false,
      buildDirectory: 'build',
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: '/app/entry.client.tsx',
      },
    },
  },
  ssr: {
    noExternal: ['react-router'],
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, '../core/src'),
      '@': path.resolve(__dirname, '.'),
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
  // No proxy needed - API routes handled by React Router v7
});
