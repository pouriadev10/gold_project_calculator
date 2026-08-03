import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * تعریف جداول دیتابیس — منبع واحد حقیقت schema، از همین‌جا drizzle-kit
 * مهاجرت SQL تولید می‌کند.
 *
 * **قرارداد نام‌گذاری:** کلید شیء TypeScript همیشه camelCase است و نام
 * واقعی ستون در PostgreSQL همیشه snake_case. این تبدیل را خودِ درایور
 * انجام می‌دهد (`casing: 'snake_case'` در `platform/database/connect.ts`)
 * — پس اینجا هرگز نام ستون را دستی نمی‌نویسیم، همیشه از کلید camelCase
 * استفاده می‌کنیم و درایور خودش `createdAt` را `created_at` می‌بیند.
 *
 * جداول دامنه (tenants، parties، ledger_entries، …) از BE-007 به بعد
 * اینجا اضافه می‌شوند. تنها جدول فعلی صرفاً برای اثبات مسیر کامل
 * migration → اتصال → درج → خواندن است.
 */

/**
 * جدول کارآزمایی اتصال — نه یک موجودیت دامنه.
 *
 * تنها مصرف‌کننده‌اش تست integration اتصال دیتابیس در BE-006 است: یک ردیف
 * درج می‌کند، همان را می‌خواند، و ثابت می‌کند مسیر schema → migration →
 * drizzle-kit → PostgreSQL واقعی سرتاسر کار می‌کند. جدول‌های واقعی
 * دامنه با BE-007 (Tenants) شروع می‌شوند.
 */
export const migrationProbes = pgTable('migration_probes', {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
