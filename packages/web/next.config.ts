import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
    dirs: ['app', 'components', 'lib'],
  },
  // Turbopack configuration (stable as of Next.js 15)
  turbopack: {
    resolveAlias: {
      '~/': path.resolve('../../src') + '/',
      '@/': path.resolve('.') + '/',
    },
    resolveExtensions: ['.js', '.jsx', '.ts', '.tsx'],
  },

  // Webpack config (only for production builds when Turbopack isn't used)
  webpack: (config: unknown, { isServer, dev }: { isServer: boolean; dev: boolean }) => {
    // Skip webpack config in development with Turbopack
    if (dev && process.env.NODE_ENV !== 'production') {
      return config;
    }

    // Type-safe config manipulation with proper checks
    const webpackConfig = config as {
      resolve: {
        alias?: Record<string, string>;
        fallback?: Record<string, string | boolean>;
        extensionAlias?: Record<string, string[]>;
      };
    };

    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      '~': path.resolve('../../src'),
      '@': path.resolve('.'),
    };

    webpackConfig.resolve.extensionAlias = {
      '.js': ['.js', '.ts'],
      '.jsx': ['.jsx', '.tsx'],
    };

    // Exclude native modules from client bundle (only needed for webpack)
    if (!isServer) {
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
        util: false,
        buffer: false,
        assert: false,
        url: false,
      };
    }

    return config;
  },
};

export default nextConfig;
