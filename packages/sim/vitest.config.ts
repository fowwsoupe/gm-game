import { defineConfig } from 'vitest/config';

// Sim tests play whole seasons; CI runners are ~3.5x slower than a dev machine, so the
// default 5 s per test is too tight. Real speed limits live in perf.test.ts.
export default defineConfig({ test: { testTimeout: 20_000 } });
