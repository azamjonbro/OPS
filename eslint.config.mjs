import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';

/** Shared rules applied to every TypeScript source file in the monorepo. */
const typescriptRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  'no-console': 'error',
  eqeqeq: ['error', 'smart'],
  'prefer-const': 'error',
  'no-param-reassign': 'error',
  'object-shorthand': ['error', 'properties'],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'apps/web/.vite/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: typescriptRules,
  },
  {
    // Places allowed to write to stdout directly. The API bootstrap, because
    // the logger itself may not exist yet when configuration fails; the test
    // runner's global teardown, because it runs outside the application
    // entirely and a cleanup that failed silently is a database nobody knows
    // to remove; and the operator scripts, whose entire output is a report a
    // person reads in a terminal.
    files: [
      'apps/api/src/main.ts',
      'apps/api/src/config/env.ts',
      'apps/api/src/test/global-setup.ts',
      'apps/api/src/scripts/check-production.ts',
      'deploy/**/*.mjs',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // Operator scripts run under plain Node, outside any workspace.
    files: ['deploy/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // PM2 loads its configuration with `require`, so this one file is
    // CommonJS in an otherwise ESM repository.
    files: ['ecosystem.config.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2023,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      ...typescriptRules,
      'vue/multi-word-component-names': 'off',
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/define-macros-order': ['error', { order: ['defineProps', 'defineEmits'] }],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.config.{ts,mts,js,mjs}', 'eslint.config.mjs'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
