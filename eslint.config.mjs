import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Paths and packages the periodization engine may never reach for.
 *
 * CLAUDE.md: "Engine lives in lib/engine/ and imports nothing from app/ or
 * components/. Enforce with a lint rule if possible." This is that rule,
 * widened to cover the framework and the database as well — the engine is a
 * pure function of its inputs, so a React or Drizzle import inside it is
 * always a design error, not a shortcut.
 *
 * Relative forms are listed alongside the aliased ones because `../../app/x`
 * evades a rule that only knows about `@/app/x`.
 */
const ENGINE_FORBIDDEN_IMPORTS = [
  {
    group: [
      '@/app', '@/app/**', '**/app/**',
      '@/components', '@/components/**', '**/components/**',
      '@/lib/db', '@/lib/db/**', '**/lib/db/**',
      '@/i18n', '@/i18n/**', '**/i18n/**',
    ],
    message:
      'The engine must not import application code. It is a pure module: inputs in, Plan out. If you need something from app/, components/, lib/db/ or i18n/, pass it in as an argument instead.',
  },
  {
    group: [
      'next', 'next/**',
      'react', 'react/**',
      'react-dom', 'react-dom/**',
      'next-intl', 'next-intl/**',
      'drizzle-orm', 'drizzle-orm/**',
    ],
    message:
      'The engine must have zero framework dependencies (PRD §9). It emits i18n keys and parameters rather than calling a translation function, and returns plain data rather than touching a database.',
  },
];

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'dist/**', 'coverage/**'],
  },

  {
    files: ['lib/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ENGINE_FORBIDDEN_IMPORTS }],
    },
  },
];

export default config;
