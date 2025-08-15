import { withSentryConfig } from '@sentry/nextjs';
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

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: 'a-little-drive-llc',

  project: 'lace',

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: '/monitoring',

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
