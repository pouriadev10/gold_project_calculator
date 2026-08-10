import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { parties } from './parties';
import { priceQuotes } from './price-quotes';
import { tenants } from './tenants';
import { users } from './users';

/** فقط دو وضعیت فاز ۱ — قاعده‌ی BE-039: پیش‌نویس و نهایی صریحاً از هم جدایند. */
export const salesInvoiceStatusEnum = pgEnum('sales_invoice_status', ['DRAFT', 'FINALIZED']);

export type SalesInvoiceStatus = (typeof salesInvoiceStatusEnum.enumValues)[number];

export const salesInvoiceItemTypeEnum = pgEnum('sales_invoice_item_type', ['JEWELRY', 'COIN']);

export type SalesInvoiceItemType = (typeof salesInvoiceItemTypeEnum.enumValues)[number];

/**
 * مقدار JSON snapshot — بدون `number`، طبق قاعده‌ی ۲-۱. شکل دقیق totals و
 * settings را BE-040 (موتور قیمت‌گذاری) تعیین می‌کند؛ این تسک فقط مدل و
 * محل ذخیره است، نه فرمول.
 */
export type SalesInvoiceSnapshotValue =
  | boolean
  | null
  | string
  | readonly SalesInvoiceSnapshotValue[]
  | { readonly [key: string]: SalesInvoiceSnapshotValue };

/**
 * سربرگ فاکتور فروش — BE-039.
 *
 * برخلاف `ledger_transactions`/`inventory_movements`، این جدول append-only
 * نیست: `status`، `current_version` و `finalized_at` با هر finalize یا
 * اصلاح (BE-054) به‌روزرسانی می‌شوند. تنها چیزی که هرگز عوض نمی‌شود
 * `invoice_number` است — بعد از اولین finalize قفل می‌شود، با یک trigger
 * اختصاصی در migration، نه فقط با نظم کد.
 *
 * `invoice_number` عمداً nullable است: در فاز پیش‌نویس هنوز شماره‌ای از
 * `DocumentCountersService` مصرف نشده — اگر پیش‌نویس هرگز finalize نشود،
 * هیچ شکافی در شماره‌های واقعی فاکتور دیده نمی‌شود.
 *
 * `quote_id`/`quote_amount_rial`/`quote_observed_at` هم روی سربرگ‌اند، نه
 * روی نسخه: طبق قاعده‌ی ۲-۸ نرخ در لحظه‌ی اولین finalize قفل می‌شود و در
 * اصلاح‌های بعدی (که فقط خطای وزن/عیار/اجرت را درست می‌کنند، نه معامله‌ی
 * تازه‌ای با نرخ تازه) ثابت می‌ماند.
 */
export const salesInvoices = pgTable(
  'sales_invoices',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceNumber: integer(),
    currentVersion: integer().notNull().default(0),
    status: salesInvoiceStatusEnum().notNull().default('DRAFT'),
    partyId: uuid().notNull(),
    quoteId: uuid().references(() => priceQuotes.id, { onDelete: 'restrict' }),
    quoteAmountRial: bigint({ mode: 'bigint' }),
    quoteObservedAt: timestamp({ withTimezone: true }),
    finalizedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: 'sales_invoices_tenant_party_fk',
    }),

    check('sales_invoices_current_version_nonnegative_check', sql`${table.currentVersion} >= 0`),
    check(
      'sales_invoices_number_when_finalized_check',
      sql`(${table.status} = 'FINALIZED') = (${table.invoiceNumber} IS NOT NULL)`,
    ),
    check(
      'sales_invoices_quote_when_finalized_check',
      sql`${table.status} = 'DRAFT' OR (
        ${table.quoteId} IS NOT NULL AND
        ${table.quoteAmountRial} IS NOT NULL AND
        ${table.quoteObservedAt} IS NOT NULL AND
        ${table.finalizedAt} IS NOT NULL
      )`,
    ),

    /* کلید مرکب برای FK هم‌مستأجرِ نسخه‌ها و ردیف‌های فاکتور. */
    unique('sales_invoices_tenant_id_id_unique').on(table.tenantId, table.id),
    uniqueIndex('sales_invoices_tenant_number_unique').on(table.tenantId, table.invoiceNumber),
    index('sales_invoices_tenant_party_idx').on(table.tenantId, table.partyId),
    index('sales_invoices_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

/**
 * نسخه‌ی immutable فاکتور — BE-039. هیچ ردیفی هرگز update یا delete
 * نمی‌شود (تریگر migration)؛ اصلاح یعنی نسخه‌ی تازه با version بزرگ‌تر.
 *
 * `reason` برای نسخه‌ی ۱ همیشه `NULL` است — نسخه‌ی اول یک اصلاح نیست.
 * enum دلایل اصلاح (WEIGHT_ERROR و…) کار BE-053 است؛ اینجا فقط متن آزاد
 * نگه داشته می‌شود تا این تسک زودتر از موعد قاعده‌ای برای آن تسک نسازد.
 */
export const salesInvoiceVersions = pgTable(
  'sales_invoice_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid().notNull(),
    salesInvoiceId: uuid().notNull(),
    version: integer().notNull(),
    reason: text(),
    totalsSnapshot: jsonb().$type<SalesInvoiceSnapshotValue>().notNull(),
    settingsSnapshot: jsonb().$type<SalesInvoiceSnapshotValue>().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.salesInvoiceId],
      foreignColumns: [salesInvoices.tenantId, salesInvoices.id],
      name: 'sales_invoice_versions_tenant_invoice_fk',
    }).onDelete('cascade'),

    check('sales_invoice_versions_version_positive_check', sql`${table.version} >= 1`),
    check(
      'sales_invoice_versions_reason_on_amendment_check',
      sql`${table.version} = 1 OR ${table.reason} IS NOT NULL`,
    ),

    unique('sales_invoice_versions_tenant_id_id_unique').on(table.tenantId, table.id),
    uniqueIndex('sales_invoice_versions_tenant_invoice_version_unique').on(
      table.tenantId,
      table.salesInvoiceId,
      table.version,
    ),
  ],
);

/**
 * ردیف‌های یک نسخه‌ی فاکتور — BE-039. مثل خودِ نسخه، append-only.
 *
 * شناسه‌ی کالا (`item_id`) چندریختی است (به `jewelry_items` یا
 * `coin_types` می‌رود) و عمداً کلید خارجی ندارد — همان الگوی
 * `inventory_movements.item_id`.
 */
export const salesInvoiceItems = pgTable(
  'sales_invoice_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid().notNull(),
    salesInvoiceId: uuid().notNull(),
    salesInvoiceVersionId: uuid().notNull(),
    itemType: salesInvoiceItemTypeEnum().notNull(),
    itemId: uuid().notNull(),
    quantity: integer().notNull(),
    lineSnapshot: jsonb().$type<SalesInvoiceSnapshotValue>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.salesInvoiceId],
      foreignColumns: [salesInvoices.tenantId, salesInvoices.id],
      name: 'sales_invoice_items_tenant_invoice_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.salesInvoiceVersionId],
      foreignColumns: [salesInvoiceVersions.tenantId, salesInvoiceVersions.id],
      name: 'sales_invoice_items_tenant_version_fk',
    }).onDelete('cascade'),

    check('sales_invoice_items_quantity_positive_check', sql`${table.quantity} > 0`),

    index('sales_invoice_items_tenant_version_idx').on(table.tenantId, table.salesInvoiceVersionId),
  ],
);

export type SalesInvoice = typeof salesInvoices.$inferSelect;
export type SalesInvoiceVersion = typeof salesInvoiceVersions.$inferSelect;
export type SalesInvoiceItem = typeof salesInvoiceItems.$inferSelect;
