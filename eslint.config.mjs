import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'playwright-report/**'] },
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
    files: ['apps/api/src/common/db/**', 'apps/api/test/**', 'apps/api/scripts/**', 'apps/api/src/common/auth/auth.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
