/**
 * Config base de ESLint (flat config) para o monorepo Elemento.
 * Cada workspace importa este array e pode adicionar overrides específicos.
 *
 * Decisão: trocamos eslint-plugin-import por eslint-plugin-import-x porque
 * eslint-plugin-import 2.x não suporta ESLint 9 flat config (peer dep máximo: ^8).
 * eslint-plugin-import-x 3.x é um fork mantido com suporte nativo a flat config.
 */
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'import-x': importX,
    },
    rules: {
      // ── Core overrides for TypeScript ────────────────────────────────────────
      // no-undef is redundant in TypeScript — the compiler handles undefined
      // references. Disabling prevents false positives on JSX, Node globals, etc.
      'no-undef': 'off',

      // ── TypeScript ──────────────────────────────────────────────────────────
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',

      // ── Imports ─────────────────────────────────────────────────────────────
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // ── Estilo ──────────────────────────────────────────────────────────────
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
    settings: {
      'import-x/resolver': {
        node: true,
      },
    },
  },
  {
    // Ignorados globalmente — nunca lintados
    ignores: ['dist/**', 'build/**', '.next/**', 'node_modules/**', 'coverage/**'],
  },
];

export default config;
