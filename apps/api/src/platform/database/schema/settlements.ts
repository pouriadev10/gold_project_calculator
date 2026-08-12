import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { assetDimensions } from './asset-dimensions';
import { ledgerAccounts } from './ledger-accounts';
import { parties } from './parties';
import { priceQuotes } from './price-quotes';
import { tenants } from './tenants';
import { users } from './users';

/** پیش‌نویس و نهایی صریحاً جدا — همان تصمیم BE-039 برای فاکتور فروش. */
export const settlementStatusEnum = pgEnum('settlement_status', ['DRAFT', 'FINALIZED']);

export type SettlementStatus = (typeof settlementStatusEnum.enumValues)[number];

export const settlementLineTypeEnum = pgEnum('settlement_line_type', [
  'RIAL',
  'GOLD',
  'COIN',
  'CREDIT',
]);

export type SettlementLineType = (typeof settlementLineTypeEnum.enumValues)[number];

/** مقدار JSON snapshot نرخ/تبدیل قفل‌شده — بدون `number`، طبق قاعده‌ی ۲-۱. */
export type SettlementLineSnapshotValue =
  | boolean
  | null
  | string
  | readonly SettlementLineSnapshotValue[]
  | { readonly [key: string]: SettlementLineSnapshotValue };

/**
 * سربرگ تسویه — BE-044. مثل `sales_invoices`، تا پیش از finalize قابل
 * تغییر است؛ append-only بودن روی خودِ ردیف‌هاست (`settlement_lines`).
 * منطق posting و ledger کار BE-045 تا BE-048 است — این فقط مدل است.
 */
export const settlements = pgTable(
  'settlements',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    partyId: uuid().notNull(),
    status: settlementStatusEnum().notNull().default('DRAFT'),
    effectiveAt: timestamp({ withTimezone: true }),
    finalizedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: 'settlements_tenant_party_fk',
    }),
    check(
      'settlements_finalized_fields_check',
      sql`(${table.status} = 'DRAFT') OR (${table.effectiveAt} IS NOT NULL AND ${table.finalizedAt} IS NOT NULL)`,
    ),
    unique('settlements_tenant_id_id_unique').on(table.tenantId, table.id),
    index('settlements_tenant_party_idx').on(table.tenantId, table.partyId),
    index('settlements_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

/**
 * ردیف‌های چندواحدی یک تسویه — BE-044. هر ردیف یک حرکت جهت‌دار
 * (`source → destination`) در دقیقاً یک بُعد است؛ سمت دفتر کل (دو entry
 * signed) را BE-045 تا BE-048 از همین ردیف می‌سازند، نه اینجا.
 *
 * Append-Only با تریگر مهاجرت (همان الگوی `inventory_movements` در
 * migration ۰۰۱۵): فقط در transaction ساخت/finalize تسویه درج می‌شود و
 * هرگز update/delete نمی‌شود؛ اصلاح یعنی تسویه‌ی جدید.
 */
export const settlementLines = pgTable(
  'settlement_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    /*
     * ارجاع مستقیم به tenants (نه فقط از راه settlements) — مثل
     * inventory_movements. بدون آن، حذف tenant دو شاخه‌ی مستقل cascade
     * دارد (tenants→settlements→settlement_lines و tenants→asset_dimensions)
     * که ترتیب پردازش‌شان تضمین‌شده نیست؛ Postgres ممکن است پیش از حذف
     * ردیف‌های settlement_lines به بررسی RESTRICT بعد برسد.
     */
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    settlementId: uuid().notNull(),
    lineType: settlementLineTypeEnum().notNull(),
    dimensionId: uuid().notNull(),
    /** بزرگی حرکت. جهت را `sourceAccountId`/`destinationAccountId` می‌سازند، نه علامت. */
    quantity: bigint({ mode: 'bigint' }).notNull(),
    sourceAccountId: uuid().notNull(),
    destinationAccountId: uuid().notNull(),
    /** فقط ردیف‌های تبدیل‌محور (طلا/سکه روی طلب ریالی) لازمش دارند. */
    lockedQuoteId: uuid(),
    lockedQuoteAmountRial: bigint({ mode: 'bigint' }),
    lockedConversionSnapshot: jsonb().$type<SettlementLineSnapshotValue>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.settlementId],
      foreignColumns: [settlements.tenantId, settlements.id],
      name: 'settlement_lines_tenant_settlement_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.dimensionId],
      foreignColumns: [assetDimensions.tenantId, assetDimensions.id],
      name: 'settlement_lines_tenant_dimension_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'settlement_lines_tenant_source_account_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.destinationAccountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
      name: 'settlement_lines_tenant_destination_account_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.lockedQuoteId],
      foreignColumns: [priceQuotes.tenantId, priceQuotes.id],
      name: 'settlement_lines_tenant_quote_fk',
    }).onDelete('restrict'),
    check('settlement_lines_quantity_positive_check', sql`${table.quantity} > 0`),
    check(
      'settlement_lines_accounts_distinct_check',
      sql`${table.sourceAccountId} <> ${table.destinationAccountId}`,
    ),
    index('settlement_lines_tenant_settlement_idx').on(table.tenantId, table.settlementId),
  ],
);

export type Settlement = typeof settlements.$inferSelect;
export type SettlementLine = typeof settlementLines.$inferSelect;
