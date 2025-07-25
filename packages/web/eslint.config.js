// ABOUTME: ESLint configuration for the web package
// ABOUTME: Extends the root configuration with Next.js specific rules
import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  {
    ignores: ['.next/**/*', 'node_modules/**/*', '.storybook/**/*'],
  },
  // Add Next.js specific configuration
  ...compat.config({
    extends: ['next/core-web-vitals'],
  }),
  // Extend selected rules from root config
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      'no-relative-import-paths': noRelativeImportPaths,
      '@typescript-eslint': tseslint,
      'import': importPlugin,
    },
    rules: {
      // Override Next.js defaults with project standards
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-relative-import-paths/no-relative-import-paths': [
        'error',
        { allowSameFolder: true, rootDir: '.', prefix: '@' }
      ],
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../*'],
            message: 'Use @ alias instead of relative parent imports'
          }
        ]
      }],
      'no-var': 'error',
      // Add TypeScript ESLint rules from root config
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }], // Allow only warn/error in tests
      'no-restricted-imports': 'off',
      // Disable unsafe TypeScript rules for test files (testing library returns any types)
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: ['**/*.stories.tsx', '**/*.stories.ts'],
    rules: {
      'no-console': 'off', // Allow console.log in Storybook stories for debugging
      'react-hooks/rules-of-hooks': 'off', // Allow hooks in Storybook render functions
      '@typescript-eslint/no-explicit-any': 'off', // Allow any types in Storybook stories
      '@typescript-eslint/no-unsafe-assignment': 'off', // Allow unsafe assignments in stories
      '@typescript-eslint/no-unsafe-member-access': 'off', // Allow unsafe member access in stories
      '@typescript-eslint/no-unsafe-call': 'off', // Allow unsafe calls in stories
      '@typescript-eslint/no-unsafe-return': 'off', // Allow unsafe returns in stories
      '@typescript-eslint/no-unsafe-argument': 'off', // Allow unsafe arguments in stories
    },
  },
  {
    files: ['components/**/*.ts', 'components/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off', // Allow unused vars in components
    },
  },
];

export default config;