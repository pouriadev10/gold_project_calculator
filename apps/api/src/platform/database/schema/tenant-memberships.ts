import { pgTable, timestamp, unique, uuid, text } from 'drizzle-orm/pg-core';
import { roles } from './roles';
import { tenants } from './tenants';
import { users } from './users';
import type { RoleCode } from './roles';

/**
 * عضویت یک کاربر در یک مستأجر، با نقشش.
 *
 * **نقش اینجاست، نه روی `users`** — قاعده‌ی صریح BE-010. دلیلش این است
 * که «مدیر» یک صفت شخص نیست، صفت رابطه‌ی شخص با یک کسب‌وکار است: همان
 * حسابدار می‌تواند در طلافروشی الف مدیر باشد و در ب صندوق‌دار. اگر نقش
 * روی کاربر می‌نشست، دومین مستأجر همان شخص را با دسترسی اشتباه می‌دید.
 */
export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /*
     * `restrict` عمدی است: نقشی که کسی داراست نباید حذف شود. با
     * `cascade` حذف یک ردیف از `roles` بی‌صدا عضویت‌ها را هم می‌برد و
     * کاربر بدون هیچ ردی دسترسی‌اش را از دست می‌داد.
     */
    roleCode: text()
      .notNull()
      .$type<RoleCode>()
      .references(() => roles.code, { onDelete: 'restrict' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /*
     * «membership تکراری ایجاد نشود» — قاعده‌ی BE-010.
     *
     * در سطح دیتابیس اعمال می‌شود، نه با یک `SELECT` قبل از `INSERT`:
     * آن الگو یک شرط رقابتی است و دو درخواست هم‌زمان هر دو خالی بودن را
     * می‌بینند. همان درسی که در BE-007 روی slug گرفتیم.
     *
     * یک کاربر در یک مستأجر دقیقاً یک نقش دارد؛ تغییر نقش یعنی `UPDATE`
     * همین ردیف، نه ردیف دوم.
     */
    unique('tenant_memberships_tenant_user_unique').on(table.tenantId, table.userId),
  ],
);

export type TenantMembership = typeof tenantMemberships.$inferSelect;
