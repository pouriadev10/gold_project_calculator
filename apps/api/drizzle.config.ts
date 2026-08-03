import { defineConfig } from 'drizzle-kit';

/**
 * پیکربندی drizzle-kit — ابزار CLI، جدا از runtime برنامه.
 *
 * `casing: 'snake_case'` باید اینجا هم تکرار شود، دقیقاً هماهنگ با
 * `platform/database/connect.ts`؛ وگرنه SQL تولیدشده با چیزی که درایور
 * در زمان اجرا واقعاً می‌فرستد فرق می‌کند.
 *
 * `dbCredentials.url` مستقیم `process.env.DATABASE_URL` را می‌خواند —
 * این ابزار خارج از NestJS اجرا می‌شود، پس از `envSchema` (BE-004) عبور
 * نمی‌کند. مسئولیتش فقط تولید و اجرای SQL است، نه اعتبارسنجی config برنامه.
 */
export default defineConfig({
  dialect: 'postgresql',
  casing: 'snake_case',
  schema: './src/platform/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
