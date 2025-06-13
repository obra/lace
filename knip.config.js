// ABOUTME: Knip configuration for dead code detection in the Lace project
// ABOUTME: Handles mixed JS/TS files with proper test exclusions and entry points

export default {
  // Entry points - where the application starts
  entry: [
    'src/ui/lace-ui.ts',         // UI entry point
  ],

  // Additional entry points for specific functionality
  project: [
    'src/**/*.{js,ts,tsx}',      // All source files
    'test/jest-resolver.js',     // Jest resolver
    'test/jest-setup*.js',       // Jest setup files
    'test/test-harness.ts',      // Test harness
  ],

  // Files to ignore completely
  ignore: [
    // Temporary and debug files
    'tmp/**',
    'debug-*',
    '*.log',
    'test-context-*/**',
    'test-db-*.db',
    'test.txt',
    
    // Documentation and notes
    'docs/**',
    '*.md',
    'convos-todo.md',
    'models-refactor-todo.md',
    'plugins-cleanup.md',
    'bad-tests.md',

    // Build and config files
    'node_modules/**',
    '*.config.{js,ts}',
    'tsconfig.json',
    '.git/**',
  ],

  // Enable Jest plugin for proper test handling
  jest: {
    // Automatically detect Jest config files
    config: ['jest.config.js', 'jest.integration.config.js']
  },

  // Exclude specific patterns from being marked as unused
  ignoreDependencies: [
    '@types/*',                // Type definitions
    'jest-*',                  // Jest ecosystem packages
  ],

  ignoreExportsUsedInFile: true
};