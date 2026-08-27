import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // Existing client pages intentionally load remote state in abortable
    // effects. Keep those patterns reviewable without treating them as build
    // failures under React 19's advisory rule.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'react/no-unescaped-entities': 'warn',
    },
  },
  globalIgnores([
    '.next/**',
    'coverage/**',
    'packages/*/dist/**',
    'services/*/dist/**',
    'tmp/**',
    'next-env.d.ts',
  ]),
]);
