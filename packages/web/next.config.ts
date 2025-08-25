// ABOUTME: Next.js configuration for the web interface with webpack customizations and build settings
// ABOUTME: Configures aliases, externals, Sentry integration, and standalone build optimizations
import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { withSentryConfig } from '@sentry/nextjs';

// Determine if we should build standalone (only for production or explicit standalone builds)
const isStandaloneBuild =
  process.env.BUILD_STANDALONE === 'true' || process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  ...(isStandaloneBuild && {
    output: 'standalone',
    outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
    outputFileTracingIncludes: {
      '/': ['packages/web/server-custom.ts'],
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
      '~': fileURLToPath(new URL('../core/src', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
    resolveExtensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
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
