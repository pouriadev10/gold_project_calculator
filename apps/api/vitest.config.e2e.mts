import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** تست‌های e2e — جدا از `pnpm test` تا نشست تست واحد سریع بماند. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
  },
});
