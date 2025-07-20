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
      '~': path.resolve('.'),
    },
    resolveExtensions: ['.js', '.jsx', '.ts', '.tsx'],
  },
  
  // Webpack config (only for production builds when Turbopack isn't used)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (config: any, { isServer, dev }: { isServer: boolean; dev: boolean }) => {
    // Skip webpack config in development with Turbopack
    if (dev && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return config;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    config.resolve.alias = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ...config.resolve.alias,
      '~': path.resolve('.'),
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts'],
      '.jsx': ['.jsx', '.tsx'],
    };

    // Exclude native modules from client bundle (only needed for webpack)
    if (!isServer) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      config.resolve.fallback = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        ...config.resolve.fallback,
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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return config;
  },
};

export default nextConfig;
