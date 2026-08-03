import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * وضعیت مستأجر.
 *
 * enum واقعی PostgreSQL است نه `text`، تا مقدار نامعتبر حتی با SQL مستقیم
 * هم وارد نشود — همان استدلالی که BE-063 برای بقیه‌ی محدودیت‌ها دارد.
 */
export const tenantStatusEnum = pgEnum('tenant_status', ['ACTIVE', 'SUSPENDED']);

export type TenantStatus = (typeof tenantStatusEnum.enumValues)[number];

/**
 * منطقه‌ی زمانی پیش‌فرض.
 *
 * قاعده‌ی BE-007: «timezone پیش‌فرض داده‌ای باشد، نه مقدار پراکنده در کد».
 * این ثابت فقط برای تولید `DEFAULT` در خودِ ستون به کار می‌رود — یعنی
 * مقدار واقعاً در دیتابیس می‌نشیند و هر مسیر درجی (حتی SQL مستقیم) همان
 * را می‌گیرد. هیچ Service ای اجازه ندارد این را به‌عنوان fallback در کد
 * تکرار کند؛ مقدار مؤثر همیشه از ردیف خوانده می‌شود.
 */
export const DEFAULT_TENANT_TIMEZONE = 'Asia/Tehran';

/**
 * مستأجر — ریشه‌ی چندمستأجری بودن سیستم.
 *
 * این جدول عمداً `tenant_id` ندارد و مشمول RLS نیست: خودش تعریف‌کننده‌ی
 * مرز است، نه داده‌ی داخل مرز. RLS از BE-009 روی جداول داده‌ی مستأجر
 * اعمال می‌شود.
 */
export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  /** یکتا در کل سامانه — مستأجر بالاترین سطح است و به چیزی scope نمی‌شود. */
  slug: text().notNull().unique(),
  status: tenantStatusEnum().notNull().default('ACTIVE'),
  timezone: text().notNull().default(DEFAULT_TENANT_TIMEZONE),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /*
   * `$onUpdate` سطح ORM است، نه تریگر دیتابیس — یعنی `UPDATE` خام SQL
   * آن را تازه نمی‌کند. تا وقتی تنها مسیر نوشتن از داخل برنامه است کافی
   * است؛ اگر بعداً لازم شد، تریگر دیتابیسی جای BE-063 است.
   */
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
