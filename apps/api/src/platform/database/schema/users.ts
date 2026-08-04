import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'DISABLED']);

export type UserStatus = (typeof userStatusEnum.enumValues)[number];

/**
 * کاربر — یک **شخص**، نه یک کارمندِ یک مستأجر.
 *
 * عمداً `tenant_id` ندارد و مشمول RLS نیست: قاعده‌ی BE-010 می‌گوید «یک
 * user بتواند در آینده عضو چند tenant باشد». اگر کاربر به مستأجر گره
 * می‌خورد، حسابدارِ دو طلافروشی باید دو حساب جدا می‌ساخت و همان لحظه
 * مدل شکسته بود. رابطه‌ی کاربر با مستأجر در `tenant_memberships` است.
 *
 */
export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  /**
   * یکتا در کل سامانه و همیشه با حروف کوچک ذخیره می‌شود.
   * نرمال‌سازی در لایه‌ی سرویس انجام می‌شود، چون یکتایی روی مقدار
   * ذخیره‌شده اعمال می‌شود: بدون آن، `Ali@x.com` و `ali@x.com` دو
   * حساب متفاوت می‌ساختند.
   */
  email: text().notNull().unique(),
  displayName: text().notNull(),
  /**
   * هش Argon2id رمز عبور — BE-011.
   *
   * nullable است چون «کاربر بدون رمز» یک حالت واقعی است، نه نقص داده:
   * کاربری که دعوت شده ولی هنوز رمز نگذاشته. مقدار `null` یعنی این حساب
   * نمی‌تواند وارد شود، و `AuthService` دقیقاً همان پاسخ عمومی «ایمیل یا
   * رمز نادرست» را می‌دهد تا وجود یا نبود حساب لو نرود.
   */
  passwordHash: text(),
  status: userStatusEnum().notNull().default('ACTIVE'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type User = typeof users.$inferSelect;
