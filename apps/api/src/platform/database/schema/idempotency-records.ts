import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/** وضعیت ثبت کلید تکرارناپذیری در همان تراکنش رویداد. */
export const idempotencyRecordStatus = pgEnum('idempotency_record_status', [
  'PENDING',
  'COMPLETED',
]);

/**
 * پاسخ ذخیره‌شده باید JSON باشد تا دقیقاً همان payload قابل بازپخش باشد.
 *
 * پول و وزن همچنان قرارداد صریح خود را در DTO دارند و هرگز `number` نیستند؛
 * این نوع فقط شکل عمومی JSON برای زیرساخت idempotency است.
 */
export type StoredJson =
  | boolean
  | null
  | number
  | string
  | readonly StoredJson[]
  | { readonly [key: string]: StoredJson };

/**
 * کلیدهای تکرارناپذیری درخواست‌های یک مستأجر — BE-013.
 *
 * محدودیت یکتا روی `(tenant_id, key)` داور هم‌زمانی است. درج رقیب در
 * PostgreSQL تا commit یا rollback درخواست اول صبر می‌کند؛ بنابراین دو درخواست
 * هم‌زمان نمی‌توانند هر دو اثر مالی را ثبت کنند.
 */
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    requestHash: text().notNull(),
    status: idempotencyRecordStatus().notNull(),
    responseStatus: integer(),
    responseBody: jsonb().$type<StoredJson>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_records_tenant_key_unique').on(table.tenantId, table.key),
    index('idempotency_records_expires_at_idx').on(table.expiresAt),
  ],
);

export type IdempotencyRecord = typeof idempotencyRecords.$inferSelect;
