import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/** تعداد ردیف هر بخش خروجی، با نام بخش. */
export type TenantExportRowCounts = Record<string, number>;

/**
 * خروجی کامل داده‌ی یک مستأجر — BE-069.
 *
 * محتوای JSON همان‌طور که دانلود می‌شود ذخیره می‌شود، تا دانلود دوم دقیقاً
 * همان بایت‌ها (و همان sha256) باشد و نه یک snapshot تازه. `text` است نه
 * `bytea` فشرده: PostgreSQL مقدار بزرگ را خودش در TOAST فشرده می‌کند.
 *
 * append-only است مثل بقیه‌ی سندها: یک خروجی گرفته‌شده هرگز بازنویسی
 * نمی‌شود؛ خروجی تازه یعنی ردیف تازه.
 */
export const tenantExports = pgTable(
  'tenant_exports',
  {
    id: uuid().primaryKey(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    schemaVersion: integer().notNull(),
    /** لحظه‌ی snapshot — شروع تراکنش REPEATABLE READ که داده را خواند. */
    snapshotAt: timestamp({ withTimezone: true }).notNull(),
    content: text().notNull(),
    contentSha256: text().notNull(),
    byteSize: bigint({ mode: 'bigint' }).notNull(),
    rowCounts: jsonb().$type<TenantExportRowCounts>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('tenant_exports_schema_version_positive_check', sql`${table.schemaVersion} > 0`),
    check('tenant_exports_sha256_format_check', sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check('tenant_exports_byte_size_check', sql`${table.byteSize} = octet_length(${table.content})`),
    index('tenant_exports_tenant_created_at_idx').on(table.tenantId, table.createdAt),
  ],
);

export type TenantExport = typeof tenantExports.$inferSelect;
