import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * جدول کارآزمایی اتصال — نه یک موجودیت دامنه.
 *
 * تنها مصرف‌کننده‌اش تست integration اتصال دیتابیس در BE-006 است: یک ردیف
 * درج می‌کند، همان را می‌خواند، و ثابت می‌کند مسیر schema → migration →
 * drizzle-kit → PostgreSQL واقعی سرتاسر کار می‌کند.
 */
export const migrationProbes = pgTable('migration_probes', {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
