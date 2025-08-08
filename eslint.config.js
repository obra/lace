import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths';
import vitest from 'eslint-plugin-vitest';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**/*', 'packages/**/*', 'vitest.config.ts', 'knip.config.ts', 'scripts/**/*', 'src/vfs/**/*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map(config => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['dist/**/*', 'packages/**/*', 'src/vfs/**/*'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['dist/**/*', 'packages/**/*', 'src/vfs/**/*'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
      parserOptions: {
        project: './tsconfig.json',
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
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
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
      'no-restricted-globals': ['error', {
        name: 'location',
        message: 'Use Next.js router.push() instead of window.location for navigation in React components'
      }],
      'no-restricted-properties': ['error', {
        object: 'window',
        property: 'location',
        message: 'Use Next.js router.push() instead of window.location for navigation in React components'
      }],
      'no-var': 'error'
    },
  },
  {
    files: ['src/cli/**/*.ts', 'src/interfaces/**/*.ts', 'src/app.ts'],
    ignores: ['dist/**/*', 'packages/**/*', 'src/vfs/**/*'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ignores: ['dist/**/*', 'packages/**/*', 'src/vfs/**/*'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
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
      'no-var': 'error'
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    ignores: ['dist/**/*', 'packages/**/*', 'src/vfs/**/*'],
    plugins: {
      vitest,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-console': 'off',
      ...vitest.configs.recommended.rules,
    },
  },
];
