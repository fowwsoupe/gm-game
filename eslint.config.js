import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/release/**', '**/node_modules/**', 'ml/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The sim engine must stay pure: no Node, no DOM, no UI, no database.
    // That is what lets it run in a worker, in tests, and later for NBA/NFL.
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'worker_threads'],
              message: 'sim must not use Node APIs',
            },
            {
              group: ['react', 'react-dom', 'electron', 'better-sqlite3', '@gm/data'],
              message: 'sim must stay independent of UI, Electron and storage',
            },
          ],
        },
      ],
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
);
