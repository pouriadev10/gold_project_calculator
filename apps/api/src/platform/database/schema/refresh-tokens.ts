import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * نشست‌های فعال — BE-011.
 *
 * عمداً **مشمول RLS نیست**، هرچند `tenant_id` دارد. دلیلش ترتیب است:
 * این جدول همان چیزی است که مستأجر جاری را **تعیین** می‌کند، پس نمی‌تواند
 * پشت سیاستی قرار بگیرد که به مستأجر جاری نیاز دارد. در لحظه‌ی تمدید
 * توکن هنوز هیچ مستأجری در context نیست. همان استدلال `tenants` و `users`.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * نشست به یک مستأجر گره خورده است.
     *
     * قاعده‌ی BE-011: «tenant فعال در token مشخص باشد». کاربری که عضو دو
     * طلافروشی است، برای هرکدام نشست جدا می‌گیرد — وگرنه تمدید توکن
     * می‌توانست بی‌صدا مستأجر را عوض کند.
     */
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * فقط هش SHA-256 توکن ذخیره می‌شود، نه خودش.
     *
     * چرا SHA-256 و نه Argon2id مثل رمز عبور: توکن تمدید ۳۲ بایت تصادفی
     * است، یعنی آنتروپی‌اش آن‌قدر بالاست که حمله‌ی فرهنگ‌لغتی معنا ندارد.
     * Argon2 عمداً کند است و اینجا هزینه‌اش دوبرابر است — هم هر تمدید را
     * کند می‌کند، هم چون هش نمکدار است دیگر نمی‌شود با ایندکس پیدایش کرد
     * و باید کل جدول پیمایش شود.
     */
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** `null` یعنی نشست هنوز زنده است. باطل‌شده‌ها برای ردیابی می‌مانند. */
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // برای باطل کردن همه‌ی نشست‌های یک کاربر هنگام تغییر رمز یا تعلیق.
    index('refresh_tokens_user_idx').on(table.userId),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
