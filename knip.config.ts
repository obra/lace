// ABOUTME: Knip configuration for dead code analysis
// ABOUTME: Configures Storybook and other dev tools as valid entrypoints

export default {
  ignore: [
    'debug-provider-defaults.js', // Debug script
    'packages/web/eslint.config.js', // ESLint config causes issues when run from root
    // Ignore unused directories - intentionally moved files
    'packages/web/unused/**/*',
    'unused/**/*',
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
      ],
      // Enable Storybook plugin
      storybook: true,
      // Disable ESLint plugin to avoid module resolution issues
      eslint: false,
    },
  },
};
