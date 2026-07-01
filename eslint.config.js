// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([globalIgnores([
  'dist',
  'dist-lambda',       // bundles de Lambda (build output)
  '.amplify',          // artefactos generados por ampx
  'coverage',
  'playwright-report',
  'test-results',
]), {
  files: ['**/*.{ts,tsx}'],
  extends: [
    js.configs.recommended,
    tseslint.configs.recommended,
    reactHooks.configs.flat.recommended,
    reactRefresh.configs.vite,
  ],
  languageOptions: {
    ecmaVersion: 2020,
    globals: globals.browser,
  },
  rules: {
    // Convención: un identificador prefijado con `_` es intencionalmente sin usar
    // (arg de firma que no se consume, prop reservada) → no es error.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    // Reglas advisory del React Compiler (eslint-plugin-react-hooks v6) y de
    // fast-refresh: son GUÍA, no bugs de correctitud (setState-en-efecto, purity,
    // etc. son patrones válidos). Las dejamos como WARNING —visibles, no bloquean—
    // en vez de refactorizar decenas de efectos con riesgo de regresión. El gate
    // de CI bloquea sobre ERRORES (unused-vars, any, parse…), que sí son deuda real.
    'react-hooks/set-state-in-effect': 'warn',
    'react-hooks/purity': 'warn',
    'react-hooks/immutability': 'warn',
    'react-hooks/refs': 'warn',
    'react-hooks/incompatible-library': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    'react-refresh/only-export-components': 'warn',
  },
}, ...storybook.configs["flat/recommended"]])
