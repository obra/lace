// ABOUTME: Knip configuration for dead code analysis
// ABOUTME: Configures entry points and ignores for the Lace TypeScript monorepo

export default {
  ignoreDependencies: [
    // ESLint tooling - used in config files that knip has trouble analyzing
    '@typescript-eslint/eslint-plugin',
    '@typescript-eslint/parser',
    '@eslint/eslintrc',
    'eslint-plugin-import',
    'eslint-plugin-no-relative-import-paths',
    // Development utilities
    'tsx',
  ],
  workspaces: {
    '.': {
      // Root workspace configuration
      entry: ['src/**/*.ts'],
      project: ['src/**/*.ts'],
    },
  },
};
