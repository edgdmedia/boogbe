import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'playwright-report/**', '.worktrees/**', '.superpowers/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        { paths: [{ name: '@prisma/client', importNames: ['PrismaClient'], message: 'Use OrgDb (common/db).' }] },
      ],
    },
  },
  {
    // PM2 loads this as CommonJS.
    files: ['ecosystem.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', process: 'readonly', require: 'readonly' } },
  },
  {
    files: ['apps/api/src/common/db/**', 'apps/api/test/**', 'apps/api/scripts/**', 'apps/api/src/common/auth/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
