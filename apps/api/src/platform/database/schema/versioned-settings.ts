import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * مقدار setting روی دیسک و سیم JSON-safe است. اعداد پولی و وزنی اینجا هم
 * باید رشته باشند؛ `number` شناور هرگز قرارداد مقدارهای صنفی نیست.
 */
export type VersionedSettingValue =
  | boolean
  | null
  | string
  | readonly VersionedSettingValue[]
  | { readonly [key: string]: VersionedSettingValue };

/**
 * تاریخچه‌ی نسخه‌دار تنظیمات مستأجر — BE-018.
 *
 * هر ردیف یک بازه‌ی نیمه‌باز `[valid_from, valid_to)` است. Exclusion
 * constraint در migration تضمین می‌کند دو نسخه از یک کلید در یک مستأجر هرگز
 * هم‌پوشانی نداشته باشند؛ Drizzle هنوز سازنده‌ی type-safe آن constraint را
 * ندارد، پس SQL آن کنار همین schema تولید می‌شود.
 */
export const versionedSettings = pgTable(
  'versioned_settings',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    settingKey: text().notNull(),
    valueJson: jsonb().$type<VersionedSettingValue>().notNull(),
    validFrom: timestamp({ withTimezone: true }).notNull(),
    validTo: timestamp({ withTimezone: true }),
    version: integer().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'versioned_settings_valid_interval_check',
      sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),
    check('versioned_settings_version_positive_check', sql`${table.version} >= 1`),
    uniqueIndex('versioned_settings_tenant_key_version_unique').on(
      table.tenantId,
      table.settingKey,
      table.version,
    ),
    index('versioned_settings_effective_lookup_idx').on(
      table.tenantId,
      table.settingKey,
      table.validFrom,
    ),
  ],
);

export type VersionedSetting = typeof versionedSettings.$inferSelect;
