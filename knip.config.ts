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
    // Development/testing infrastructure - always ignore
    'packages/web/e2e-test-server.ts',
    'packages/web/feedback/story-types.ts',
    'packages/web/ladle.config.mjs',
    'packages/web/scripts/start-test-server.js',
  ],
  ignoreDependencies: [
    // ESLint tooling - used in config files that knip has trouble analyzing
    '@typescript-eslint/eslint-plugin',
    '@typescript-eslint/parser',
    '@eslint/eslintrc',
    'eslint-config-next',
    'eslint-plugin-import',
    'eslint-plugin-no-relative-import-paths',
    // Build tooling - used in config files
    '@playwright/test',
    'playwright',
    'autoprefixer',
    // Type definitions that may not be directly imported
    '@types/dompurify',
  ],
  workspaces: {
    '.': {
      // Root workspace configuration
      entry: ['src/**/*.ts'],
      project: ['src/**/*.ts'],
    },
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
        'stories_parked/*.stories.{ts,tsx}',
        // E2E test files
        'e2e/**/*.e2e.ts',
        'e2e/**/*.test.e2e.ts',
        // Design system components - only analyzed in production mode
        'components/ui/**/*.tsx!',
        'components/feedback/**/*.tsx!',
        'components/demo/**/*.tsx!',
        // Unused component files - only warn in production mode
        'components/chat/index.ts!',
        'components/config/ProviderDropdown.tsx!',
        'components/feedback/index.ts!',
        'components/files/CarouselCodeChanges.tsx!',
        'components/files/FileDiffViewer.demo.tsx!',
        'components/files/FileDiffViewer.integration.tsx!',
        'components/pages/AnimatedLaceApp.tsx!',
        'components/pages/ChatInterface.tsx!',
        'components/pages/LaceAppMobileSidebar.tsx!',
        'components/pages/LaceAppSidebar.tsx!',
        'components/providers/ConnectionTest.tsx!',
        'components/providers/ModelSelectionForm.tsx!',
        'components/timeline/AnimatedTimelineMessage.tsx!',
        'components/timeline/AnimatedTimelineView.tsx!',
        'components/timeline/AnimatedTypingIndicator.tsx!',
        'components/timeline/IntegrationEntry.tsx!',
        'components/timeline/UnknownEventEntry.tsx!',
        'hooks/useProviderStatus.ts!',
        'hooks/useVoiceRecognition.ts!',
        'lib/display-utils.ts!',
      ],
      // Keep ESLint plugin disabled to avoid module resolution issues
      eslint: false,
    },
  },
};
