// ABOUTME: Next.js configuration for the web interface with webpack customizations and build settings
// ABOUTME: Configures aliases, externals, Sentry integration, and standalone build optimizations
import type { NextConfig } from 'next';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'fs';
import { withSentryConfig } from '@sentry/nextjs';

interface NFTTraceData {
  summary: {
    hasIsDocker: boolean;
    hasOpen: boolean;
  };
  tracedFiles: string[];
}

// Load nft-traced dependencies - only needed for standalone builds
function getServerDependencies(): string[] {
  const traceFile = path.resolve('./server-dependencies.json');

  if (!existsSync(traceFile)) {
    throw new Error(
      `❌ NFT trace file not found at ${traceFile}. Run 'bun ../../scripts/trace-server-dependencies.mjs' first.`
    );
  }

  try {
    const traceData = JSON.parse(readFileSync(traceFile, 'utf8')) as NFTTraceData;

    if (!traceData.summary.hasIsDocker || !traceData.summary.hasOpen) {
      throw new Error(
        `❌ NFT trace is incomplete. Missing: ${!traceData.summary.hasOpen ? 'open package ' : ''}${!traceData.summary.hasIsDocker ? 'is-docker package' : ''}`
      );
    }

    return ['packages/web/server-custom.ts', ...traceData.tracedFiles];
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`❌ NFT trace file is corrupted: ${error.message}`);
    }
    throw error;
  }
}

// Determine if we should build standalone (only for production or explicit standalone builds)
const isStandaloneBuild =
  process.env.BUILD_STANDALONE === 'true' || process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  ...(isStandaloneBuild && {
    output: 'standalone',
    outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
    outputFileTracingIncludes: {
      '/**/*': getServerDependencies(),
    },
  }),
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
      '~/': fileURLToPath(new URL('../core/src', import.meta.url)) + '/',
      '@/': fileURLToPath(new URL('.', import.meta.url)) + '/',
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
      externals?: Array<
        | string
        | RegExp
        | ((ctx: unknown, callback: (error?: Error, result?: unknown) => void) => void)
      >;
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
      '~': fileURLToPath(new URL('../core/src', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
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

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
