// ABOUTME: Next.js configuration for the Lace web interface
// ABOUTME: Configures TypeScript paths and build settings

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // Handle TypeScript path aliases
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname),
      // Only add lace alias on server-side
      ...(isServer ? {
        '@lace-core': path.resolve(__dirname, '../../src'),
      } : {}),
    };
    return config;
  },

  // API routes configuration
  async headers() {
    return [
      {
        // Enable CORS for API routes if needed
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
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