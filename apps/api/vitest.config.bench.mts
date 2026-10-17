import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Performance baseline — BE-066. Separate from `test` and `test:integration`:
 * it seeds about a year of documents into its own database and takes minutes.
 * One file, one worker, so timings are not shared with other tests.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/perf/**/*.bench-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
});
