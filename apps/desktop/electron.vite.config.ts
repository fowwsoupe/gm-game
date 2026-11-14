import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Workspace packages ship as TypeScript source, so they must be bundled, not externalized.
// Native modules (better-sqlite3, steamworks.js) stay external: they're listed in "dependencies".
const bundleWorkspace = externalizeDepsPlugin({ exclude: ['@gm/shared', '@gm/sim', '@gm/data'] });

export default defineConfig({
  main: {
    plugins: [bundleWorkspace],
  },
  preload: {
    plugins: [bundleWorkspace],
    build: {
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    resolve: {
      alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
});
