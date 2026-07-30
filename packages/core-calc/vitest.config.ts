import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
