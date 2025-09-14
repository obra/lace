// ABOUTME: Knip configuration for dead code analysis
// ABOUTME: Configures entry points and ignores for React Router v7 monorepo

export default {
  ignore: [
    'packages/web/eslint.config.js', // ESLint config causes issues when run from root
    // Design system - OK to have unused exports for future components
    'packages/web/lib/animations.ts',
    'packages/web/lib/heroicons.ts',
    'packages/web/lib/fontawesome.ts',
    // E2E test infrastructure - OK to have unused exports for future tests
    'packages/web/e2e/**/*',
    // Development/testing infrastructure - always ignore
    'packages/web/e2e-test-server.ts',
    'packages/web/ladle.config.mjs',
    'packages/web/scripts/start-test-server.js',
    'packages/web/lib/server/data-dir-init.ts', // Server initialization
    // Config files
    'packages/web/eslint.config.js',
  ],
  ignoreDependencies: [
    // ESLint tooling - used in config files that knip has trouble analyzing
    '@typescript-eslint/eslint-plugin',
    '@typescript-eslint/parser',
    '@eslint/eslintrc',
    'eslint-plugin-import',
    'eslint-plugin-no-relative-import-paths',
    // Build tooling - used in config files
    '@playwright/test',
    'playwright',
    'autoprefixer',
    // Type definitions that may not be directly imported
    '@types/dompurify',
    // React Router build-time dependencies
    '@react-router/express',
    '@react-router/node',
    '@react-router/serve',
    // Vite plugins used in config
    '@vitejs/plugin-react',
    '@sentry/vite-plugin',
    // Development utilities
    'concurrently',
    'tsx',
    // Server middleware dependencies
    'compression',
    'express',
    'morgan',
    'isbot',
    '@types/compression',
    '@types/express',
    '@types/morgan',
  ],
  workspaces: {
    '.': {
      // Root workspace configuration
      entry: ['src/**/*.ts'],
      project: ['src/**/*.ts'],
    },
    'packages/web': {
      // Web workspace - React Router v7 with plugin auto-detection
      entry: [
        // Additional entry points not detected by React Router plugin
        'server-custom.ts',
        'server-production.ts',
        'server/app.ts', // Dynamically imported by server-custom.ts
        // E2E test files and setup
        'e2e/**/*.e2e.ts',
        'e2e/**/*.test.e2e.ts',
        'e2e/global-setup.ts',
        'e2e/global-teardown.ts',
        'e2e-test-server.ts',
      ],
      // Keep ESLint plugin disabled to avoid module resolution issues
      eslint: false,
    },
  },
};