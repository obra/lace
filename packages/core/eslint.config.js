import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths';
import vitest from '@vitest/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**/*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map(config => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['dist/**/*', '**/*.test.ts', '**/*.spec.ts'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['dist/**/*', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      prettier,
      'no-relative-import-paths': noRelativeImportPaths,
      'import': importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
          alwaysTryTypes: true
        }
      }
    },
    rules: {
      'import/extensions': ['error', 'ignorePackages', {
        'js': 'never',
        'mjs': 'never', 
        'jsx': 'never',
        'ts': 'never',
        'tsx': 'never'
      }],
      'prettier/prettier': 'error',
      'no-unused-vars': 'off', // Disable base rule in favor of TypeScript version
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-relative-import-paths/no-relative-import-paths': [
        'error',
        { allowSameFolder: false, rootDir: 'src', prefix: '~' }
      ],
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../*'],
            message: 'Use ~ alias instead of relative parent imports'
          }
        ]
      }],
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      'no-var': 'error'
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    ignores: ['dist/**/*'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...vitest.environments.env.globals },
      parser: tseslint.parser,
      parserOptions: {
        project: null, // Don't use TypeScript project for test files
        ecmaFeatures: {
          modules: true,
        },
      },
    },
    plugins: {
      vitest,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-console': 'off',
      'no-undef': 'off', // TypeScript handles this
      ...vitest.configs.recommended.rules,
    },
  },
  // Ensure Prettier disables conflicting stylistic rules repo-wide
  prettierConfig,
];