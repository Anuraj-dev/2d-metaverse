import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vitest from '@vitest/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'migrations', 'test/smoke.mjs']),
  // Type-checked baseline (mirrors the frontend's flat config) on all TS.
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `_next`, `_request`, etc. are deliberately-unused positional params
      // (Express error middleware needs its 4-arg shape); `_omitted` rest-picks.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // PRD-2 pino convention, mechanically enforced: no console.* in backend src.
  // The logger module (src/logger.ts) is the one legitimate console user.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/logger.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  // Vitest hygiene on backend test files (same rule set as the frontend).
  // `.skip` warns and requires a justification comment (README convention).
  {
    files: ['test/**/*.ts'],
    plugins: { vitest },
    rules: {
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'warn',
      // `expectSilence` is a custom assertion (throws on the unwanted emission),
      // so tests whose only check is a silence assertion still count as asserting.
      'vitest/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', 'expectSilence'] },
      ],
      'vitest/no-conditional-expect': 'error',
      'vitest/no-standalone-expect': 'error',
      // Integration tests assert over dynamic JSON / socket payloads that are
      // inherently `any` (fetch's `.json()`, the typed test-helper seams). The
      // type-checked no-unsafe-* family fights that by design and would force
      // churn without catching real bugs, so it's relaxed for test code only —
      // matching the frontend, whose tests lint under the non-type-checked base.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
