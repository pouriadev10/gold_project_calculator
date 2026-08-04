import { integer, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * نقش‌های فاز ۱.
 *
 * ترتیب از پرقدرت به کم‌قدرت است و همین ترتیب در `sortOrder` جدول
 * می‌نشیند — برای نمایش در فهرست‌ها، نه برای منطق مجوزدهی. مجوزدهی
 * (BE-012) بر اساس عضویت صریح در مجموعه‌ی نقش‌هاست، نه مقایسه‌ی سطح؛
 * سلسله‌مراتب ضمنی همان چیزی است که بعداً کسی را به‌اشتباه بالا می‌برد.
 */
export const PHASE_ONE_ROLES = ['OWNER', 'MANAGER', 'CASHIER'] as const;

export type RoleCode = (typeof PHASE_ONE_ROLES)[number];

/**
 * فهرست نقش‌ها — جدول است نه enum، چون قاعده‌ی BE-010 می‌گوید «فعلاً نقش
 * سفارشی ساخته نشود»؛ یعنی روزی ساخته می‌شود. با enum، افزودن نقش یک
 * `ALTER TYPE` است که در تراکنش با کارهای دیگر ترکیب نمی‌شود.
 *
 * عمداً `tenant_id` ندارد: این‌ها نقش‌های سیستمی‌اند و بین همه‌ی
 * مستأجرها مشترک. نقش سفارشیِ هر مستأجر بعداً یک ستون `tenant_id`
 * nullable اضافه می‌کند — `NULL` یعنی سیستمی.
 */
export const roles = pgTable('roles', {
  /** کد ماشین‌خوان. کلید اصلی است تا عضویت‌ها به رشته‌ی معنادار ارجاع دهند، نه یک uuid بی‌معنا. */
  code: text().primaryKey().$type<RoleCode>(),
  title: text().notNull(),
  sortOrder: integer().notNull(),
});

export type Role = typeof roles.$inferSelect;
