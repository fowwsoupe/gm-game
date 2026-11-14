import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// The sim engine must stay pure: no Node, no DOM, no UI, no database.
// That is what lets it run in a worker, in tests, in the balance lab and later for NBA/NFL.
const simPurity = [
  { group: ['node:*', 'fs', 'path', 'worker_threads'], message: 'sim must not use Node APIs' },
  {
    group: ['react', 'react-dom', 'electron', 'better-sqlite3', '@gm/data'],
    message: 'sim must stay independent of UI, Electron and storage',
  },
];

// Engines talk to each other only through their index.ts (their public API).
const engineBoundary = {
  group: ['../*/*', '!../*/index', '!../../*'],
  message: "Import another engine through its index (e.g. '../cba'), never its internal files",
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/release/**', '**/node_modules/**', 'ml/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...simPurity, engineBoundary] }],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded Rng so results are reproducible',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Sim time comes from game state, not the clock' },
      ],
    },
  },
  {
    // Root wiring files (models, commands...) use engines through their index only.
    files: ['packages/sim/src/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...simPurity,
            {
              group: ['./*/*', '!./*/index'],
              message: "Import engines through their index (e.g. './game')",
            },
          ],
        },
      ],
    },
  },
  {
    // Core is the bottom layer: it imports no engine.
    files: ['packages/sim/src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...simPurity,
            { group: ['../*'], message: 'core must not import other engines' },
          ],
        },
      ],
    },
  },
  {
    // Apps use the sim's public API only.
    files: ['apps/**/*.{ts,tsx}', 'packages/data/**/*.ts', 'tools/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@gm/sim/*'], message: "Import from '@gm/sim' only" }] },
      ],
    },
  },
);
