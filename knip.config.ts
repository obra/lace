// ABOUTME: Knip configuration for dead code analysis
// ABOUTME: Configures Storybook and other dev tools as valid entrypoints

export default {
  ignore: [
    'packages/web/eslint.config.js', // ESLint config causes issues when run from root
    'packages/web/stories_parked/**/*', // Parked story files - not active in build
    // Design system - OK to have unused exports for future components
    'packages/web/lib/animations.ts',
    'packages/web/lib/heroicons.ts',
    'packages/web/lib/fontawesome.ts',
    // E2E test infrastructure - OK to have unused exports for future tests
    'packages/web/e2e/**/*',
  ],
  workspaces: {
    'packages/web': {
      // Web workspace - Next.js with Storybook
      entry: [
        // Next.js app entrypoints (Knip auto-detects these)
        'app/**/page.tsx',
        'app/**/layout.tsx',
        'app/api/**/route.ts',
        // Server entrypoint
        'server.ts',
        // Storybook (auto-detected, but keep explicit)
        '**/*.stories.{ts,tsx}',
        // E2E test files
        'e2e/**/*.e2e.ts',
        'e2e/**/*.test.e2e.ts',
      ],
      // Disable ESLint plugin to avoid module resolution issues
      eslint: false,
    },
  },
};
