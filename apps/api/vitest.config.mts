import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * تست واحد. تبدیل با swc انجام می‌شود نه esbuild، چون esbuild
 * `emitDecoratorMetadata` را پیاده نکرده و بدون آن تزریق وابستگی Nest
 * در تست‌ها بی‌صدا می‌شکند.
 *
 * پسوند `.mts` عمدی است: این بسته CommonJS است و بدون آن، vite پیکربندی را
 * با build منسوخ‌شده‌ی CJS بارگذاری می‌کند و هر بار اخطار می‌دهد.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
  },
});
