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
    ignores: ['.next/**/*', 'node_modules/**/*'],
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
    },
  },
  {
    files: ['**/*.stories.tsx', '**/*.stories.ts'],
    rules: {
      'no-console': 'off', // Allow console.log in Storybook stories for debugging
      'react-hooks/rules-of-hooks': 'off', // Allow hooks in Storybook render functions
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