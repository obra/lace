import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths';
import vitest from 'eslint-plugin-vitest';
import globals from 'globals';

export default [
  {
    ...js.configs.recommended,
    ignores: ['dist/**/*'],
  },
  ...tseslint.configs.recommendedTypeChecked.map(config => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['dist/**/*'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['dist/**/*'],
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
    },
    settings: {
      'import/resolver': {
        typescript: {}
      }
    },
    rules: {
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
      'no-var': 'error'
    },
  },
  {
    files: ['src/cli/**/*.ts', 'src/interfaces/**/*.ts', 'src/app.ts'],
    ignores: ['dist/**/*'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ignores: ['dist/**/*'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-var': 'error'
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    ignores: ['dist/**/*'],
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
