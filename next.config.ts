import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Output directory for Next.js build
  distDir: '.next',

  // TypeScript configuration - disable Next.js TypeScript processing
  typescript: {
    ignoreBuildErrors: true, // Prevent Next.js from failing on type errors
  },

  // ESLint configuration
  eslint: {
    ignoreDuringBuilds: false,
    dirs: ['src/interfaces/web/app', 'src/interfaces/web/components', 'src/interfaces/web/lib'],
  },

  // Use webpack alias to support ~/* imports
  webpack: (config) => {
    const path = require('path');
    config.resolve.alias = {
      ...config.resolve.alias,
      '~': path.resolve(__dirname, '../../../src'),
    };
    // Support .js/.jsx imports resolving to .ts/.tsx files
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts'],
      '.jsx': ['.jsx', '.tsx'],
    };
    return config;
  },

  // Enable custom server mode (important for embedding)
  output: 'standalone',

  // Enable React strict mode
  reactStrictMode: true,

  // Configure external packages for server components
  serverExternalPackages: [],
};

export default nextConfig;
