import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { parties } from './parties';
import { tenants } from './tenants';

/** طبقه‌ی حساب، مستقل از واحدِ entryهای آینده. */
export const ledgerAccountTypeEnum = pgEnum('ledger_account_type', [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
  'CLEARING',
]);

export type LedgerAccountType = (typeof ledgerAccountTypeEnum.enumValues)[number];

/**
 * chart of accounts چندواحدیِ tenant.
 *
 * بعد از BE-032 هر entry هم به همین حساب و هم به یک asset dimension وصل
 * خواهد شد؛ بنابراین account هیچ وقت واحد پول یا وزن را در خودش نگه نمی‌دارد.
 * `partyId` برای subledger مستقیم اشخاص است و foreign key مرکب، حساب شخص
 * tenant دیگر را از نظر دیتابیس ناممکن می‌کند.
 */
export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text().notNull(),
    title: text().notNull(),
    accountType: ledgerAccountTypeEnum().notNull(),
    partyId: uuid(),
    /** قرارداد پایدار حساب‌های seedشده؛ حساب شخص عمداً این مقدار را ندارد. */
    systemKey: text(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: 'ledger_accounts_tenant_party_fk',
    }).onDelete('cascade'),

    check('ledger_accounts_code_nonblank_check', sql`length(btrim(${table.code})) > 0`),
    check('ledger_accounts_title_nonblank_check', sql`length(btrim(${table.title})) > 0`),
    check(
      'ledger_accounts_party_account_type_check',
      sql`${table.partyId} IS NULL OR ${table.accountType} IN ('ASSET', 'LIABILITY')`,
    ),
    check(
      'ledger_accounts_party_system_key_check',
      sql`${table.partyId} IS NULL OR ${table.systemKey} IS NULL`,
    ),

    unique('ledger_accounts_tenant_id_id_unique').on(table.tenantId, table.id),
    uniqueIndex('ledger_accounts_tenant_code_unique').on(table.tenantId, table.code),
    // PostgreSQL اجازه‌ی چند NULL می‌دهد؛ پس فقط system accountهای واقعی با هم مقایسه می‌شوند.
    uniqueIndex('ledger_accounts_tenant_system_key_unique').on(table.tenantId, table.systemKey),
    uniqueIndex('ledger_accounts_tenant_party_type_unique').on(
      table.tenantId,
      table.partyId,
      table.accountType,
    ),
  ],
);

export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
