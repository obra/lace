// ABOUTME: Next.js configuration for the Lace web interface
// ABOUTME: Configures TypeScript paths and build settings

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  
  // ESLint configuration
  eslint: {
    // Run ESLint on these directories during build
    dirs: ['app', 'components', 'lib', 'hooks', '__tests__'],
  },
  // Handle TypeScript path aliases
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname),
      // Only add ~ alias for main project source on server-side
      ...(isServer ? {
        '~': path.resolve(__dirname, '../../src'),
      } : {}),
    };
    return config;
  },

  // API routes configuration
  async headers() {
    return [
      {
        // CORS headers for API routes - restricted for production
        source: '/api/:path*',
        headers: [
          // In production, replace with your actual domain
          { key: 'Access-Control-Allow-Origin', value: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS,PATCH' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
        ],
      },
    ];
  },

  // Disable static optimization for SSE routes
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/sessions/:sessionId/events/stream',
          destination: '/api/sessions/:sessionId/events/stream',
          has: [{ type: 'header', key: 'accept', value: '.*text/event-stream.*' }],
        },
      ],
    };
  },
};

export default nextConfig;
