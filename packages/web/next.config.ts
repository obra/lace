import type { NextConfig } from 'next';
import path from 'path';
import { readFileSync, existsSync } from 'fs';

// Load nft-traced dependencies - only required for production builds
function getServerDependencies(): string[] {
  const traceFile = path.resolve('./server-dependencies.json');

  // In development mode, tracing is optional
  if (process.env.NODE_ENV !== 'production') {
    if (!existsSync(traceFile)) {
      return ['packages/web/server-custom.ts'];
    }
    // If trace file exists in dev, use it but don't require validation
  }

  if (!existsSync(traceFile)) {
    throw new Error(
      `❌ NFT trace file not found at ${traceFile}. Run 'bun ../../scripts/trace-server-dependencies.mjs' first.`
    );
  }

  try {
    const traceData = JSON.parse(readFileSync(traceFile, 'utf8'));

    if (!traceData.summary.hasIsDocker || !traceData.summary.hasOpen) {
      throw new Error(
        `❌ NFT trace is incomplete. Missing: ${!traceData.summary.hasOpen ? 'open package ' : ''}${!traceData.summary.hasIsDocker ? 'is-docker package' : ''}`
      );
    }

    console.log(
      `📦 Using ${traceData.tracedFiles.length} nft-traced dependencies (includes is-docker ✅)`
    );
    return ['packages/web/server-custom.ts', ...traceData.tracedFiles];
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`❌ NFT trace file is corrupted: ${error.message}`);
    }
    throw error;
  }
}

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve('../../'),
  outputFileTracingIncludes: {
    '/': getServerDependencies(),
  },
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
      externals?: any;
    };

    // Ignore all bun:* imports - they're only used in Bun runtime
    if (isServer) {
      webpackConfig.externals = [
        ...(Array.isArray(webpackConfig.externals)
          ? webpackConfig.externals
          : [webpackConfig.externals].filter(Boolean)),
        /^bun:/,
      ];
    }

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
