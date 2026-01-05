import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import vitest from '@vitest/eslint-plugin';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**/*'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
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
      parser: tseslint.parser,
      parserOptions: {
        project: null,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-var': 'error',
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
        project: null,
      },
    },
    plugins: {
      vitest,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-console': 'off',
      'no-undef': 'off',
      ...vitest.configs.recommended.rules,
    },
  },
  prettierConfig,
];

