import { sql } from 'drizzle-orm';
import { check, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/** انواع سندی که شماره‌گذاری بدون شکاف دارند — فهرست بسته، BE-038. */
export const documentTypeEnum = pgEnum('document_type', ['SALES_INVOICE']);

export type DocumentType = (typeof documentTypeEnum.enumValues)[number];

/**
 * شمارنده‌ی بدون شکاف هر سند — BE-038.
 *
 * از PostgreSQL `SEQUENCE` استفاده نشده: `nextval` خودش مستقل از تراکنش
 * فراخوان عمل می‌کند، پس rollback مصرف را برنمی‌گرداند و شکاف می‌سازد.
 * اینجا برعکس است — افزایش `current_value` بخشی از همان تراکنشِ فراخوان
 * است (`DocumentCountersService.getNextNumberInTransaction`)، پس
 * rollback فراخوان همین افزایش را هم برمی‌گرداند.
 *
 * `period_key` رشته‌ی مبهم است؛ این جدول به هیچ استراتژی دوره‌ای خاص
 * وابسته نیست. استراتژی فعلیِ فاز ۱ (سال جلالی) در
 * `document-counters.service.ts` به‌صورت `jalaliYearPeriodKey` مستند
 * است، نه در این schema.
 */
export const documentCounters = pgTable(
  'document_counters',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentType: documentTypeEnum().notNull(),
    periodKey: text().notNull(),
    currentValue: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('document_counters_current_value_nonnegative_check', sql`${table.currentValue} >= 0`),
    uniqueIndex('document_counters_tenant_type_period_unique').on(
      table.tenantId,
      table.documentType,
      table.periodKey,
    ),
  ],
);

export type DocumentCounter = typeof documentCounters.$inferSelect;
