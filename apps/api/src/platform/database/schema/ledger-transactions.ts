import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { assetDimensions } from './asset-dimensions';
import { ledgerAccounts } from './ledger-accounts';
import { tenants } from './tenants';
import { users } from './users';

/**
 * سندهای مبدأیی که در فاز ۱ مجازند یک تراکنش دفترکل بسازند.
 *
 * فهرست بسته است تا `source_type` به یک رشته‌ی بی‌معنا تبدیل نشود. هر جریان
 * جدید باید آگاهانه به migration افزوده شود، نه با SQL مستقیم در تاریخ مالی.
 */
export const ledgerTransactionSourceTypeEnum = pgEnum('ledger_transaction_source_type', [
  'OPENING_BALANCE',
  'SALES_INVOICE',
  'SECOND_HAND_PURCHASE',
  'SETTLEMENT',
  'SALES_INVOICE_AMENDMENT',
  /**
   * BE-036 — سربرگ اصلاحی، نه یک سند مبدأ کسب‌وکاری تازه. `source_id` آن
   * عمداً همان `id` تراکنش اصلی است، نه یک UUID تازه: یکتاییِ
   * `(tenant_id, source_type, source_id)` که از قبل روی این جدول هست
   * همان قفلِ «هر تراکنش حداکثر یک reversal» را بدون constraint جدید
   * می‌دهد، و تلاش دوم برای reverse کردن یک تراکنش با همان خطای رقابتیِ
   * آشنا (unique violation) رد می‌شود.
   */
  'LEDGER_REVERSAL',
]);

export type LedgerTransactionSourceType =
  (typeof ledgerTransactionSourceTypeEnum.enumValues)[number];

/**
 * JSON متادیتای entry فقط برای شناسه‌ی snapshot و داده‌ی ردیابی است.
 *
 * `number` عمداً در این نوع نیست؛ مبلغ، وزن و تعدادِ مالی اگر لازم باشد در
 * metadata تکرار شوند، باید رشته‌ی صحیح باشند. مقدار حسابداری قطعی فقط همان
 * `quantity bigint` ستون است.
 */
export type LedgerEntryMetadata =
  | boolean
  | null
  | string
  | readonly LedgerEntryMetadata[]
  | { readonly [key: string]: LedgerEntryMetadata };

/**
 * سربرگ immutable سند دفترکل.
 *
 * هر منبع دقیقاً یک transaction نهایی برای هر tenant می‌گیرد. `source_id`
 * polymorphic است، پس FK ندارد؛ اما کلید یکتا و index آن مسیر ردیابی را در
 * خود دیتابیس حفظ می‌کنند. source document محل نگهداری snapshot نرخ‌ها و
 * تنظیمات تاریخی است، نه این جدول.
 */
export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceType: ledgerTransactionSourceTypeEnum().notNull(),
    sourceId: uuid().notNull(),
    effectiveAt: timestamp({ withTimezone: true }).notNull(),
    description: text().notNull(),
    reversalOfTransactionId: uuid(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.reversalOfTransactionId],
      foreignColumns: [table.tenantId, table.id],
      name: 'ledger_transactions_tenant_reversal_fk',
    }).onDelete('set null'),

    check(
      'ledger_transactions_description_nonblank_check',
      sql`length(btrim(${table.description})) > 0`,
    ),
    check(
      'ledger_transactions_not_self_reversal_check',
      sql`${table.reversalOfTransactionId} IS NULL OR ${table.reversalOfTransactionId} <> ${table.id}`,
    ),

    /* FK مرکب entry و reversal، مخلوط شدن tenantها را از ساختار داده ناممکن می‌کند. */
    unique('ledger_transactions_tenant_id_id_unique').on(table.tenantId, table.id),
    uniqueIndex('ledger_transactions_tenant_source_unique').on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
    ),
    index('ledger_transactions_tenant_effective_at_idx').on(table.tenantId, table.effectiveAt),
    index('ledger_transactions_tenant_reversal_idx').on(
      table.tenantId,
      table.reversalOfTransactionId,
    ),
  ],
);

/**
 * ردیف‌های چندبعدیِ immutable دفترکل.
 *
 * مقدار مثبت بدهکار و مقدار منفی بستانکار است. همه‌ی ابعاد، از جمله هر نوع
 * سکه، در storage `bigint` دارند: برای سکه این عدد فقط شمارش صحیح است و هرگز
 * به وزن طلا تبدیل نمی‌شود. constraint trigger تراز مستقل هر dimension در
 * BE-033 افزوده می‌شود.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    transactionId: uuid().notNull(),
    accountId: uuid().notNull(),
    dimensionId: uuid().notNull(),
    quantity: bigint({ mode: 'bigint' }).notNull(),
    metadata: jsonb()
      .$type<LedgerEntryMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.transactionId],
      foreignColumns: [ledgerTransactions.tenantId, ledgerTransactions.id],
      name: 'ledger_entries_tenant_transaction_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.accountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'ledger_entries_tenant_account_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.dimensionId],
      foreignColumns: [assetDimensions.tenantId, assetDimensions.id],
      name: 'ledger_entries_tenant_dimension_fk',
    }).onDelete('restrict'),

    check('ledger_entries_quantity_nonzero_check', sql`${table.quantity} <> 0`),

    index('ledger_entries_tenant_transaction_idx').on(table.tenantId, table.transactionId),
    index('ledger_entries_tenant_account_dimension_idx').on(
      table.tenantId,
      table.accountId,
      table.dimensionId,
    ),
    index('ledger_entries_tenant_dimension_idx').on(table.tenantId, table.dimensionId),
  ],
);

export type LedgerTransaction = typeof ledgerTransactions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
