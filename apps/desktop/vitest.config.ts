import { resolve } from 'node:path';

/**
 * What the renderer's component tests need of `electron.vite.config.ts`, which vitest does not
 * read: the `@/` alias and JSX.
 */
export default {
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') } },
  esbuild: { jsx: 'automatic' as const },
};
