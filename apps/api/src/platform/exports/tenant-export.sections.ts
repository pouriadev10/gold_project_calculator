import { asc, eq, getTableColumns, getTableName, inArray } from 'drizzle-orm';
import {
  assetDimensions,
  auditLogs,
  coinTypes,
  coinTypeVersions,
  documentCounters,
  inventoryMovements,
  jewelryItems,
  jewelryItemVersions,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  openingBalances,
  parties,
  priceQuotes,
  salesInvoiceItems,
  salesInvoices,
  salesInvoiceVersions,
  secondHandPurchaseItems,
  secondHandPurchases,
  settlementLines,
  settlements,
  tenantMemberships,
  users,
  versionedSettings,
} from '../database/schema';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { TenantTransaction } from '../database/tenant-transaction';

/** ردیف خام یک بخش؛ `bigint` و `Date` هنگام سریال‌سازی به رشته تبدیل می‌شوند. */
export type ExportRow = Record<string, unknown>;

export interface TenantExportSection {
  /** کلید بخش در فایل خروجی. */
  readonly name: string;
  /** جدول مبدأ در دیتابیس. */
  readonly table: string;
  readonly read: (transaction: TenantTransaction, tenantId: string) => Promise<ExportRow[]>;
}

/**
 * یک جدول مستأجردار، با همه‌ی ستون‌هایش جز `omit`.
 *
 * فیلتر صریح `tenant_id` لایه‌ی دوم است؛ لایه‌ی اول RLS است، چون خواندن
 * داخل تراکنش با نقش `gold_app` انجام می‌شود. ترتیب قطعی است (زمان ساخت، بعد
 * شناسه) تا دو خروجی از داده‌ی یکسان، فایل یکسان بدهند.
 */
function tenantTable(
  name: string,
  table: PgTable & { readonly tenantId: PgColumn; readonly id: PgColumn },
  omit: readonly string[] = [],
): TenantExportSection {
  const columns = getTableColumns(table);
  const fields: Record<string, PgColumn> = Object.fromEntries(
    Object.entries(columns).filter(([key]) => !omit.includes(key)),
  );
  const createdAt = columns['createdAt'];
  const order = createdAt === undefined ? [asc(table.id)] : [asc(createdAt), asc(table.id)];

  return {
    name,
    table: getTableName(table),
    read: (transaction, tenantId) =>
      transaction
        .select(fields)
        .from(table)
        .where(eq(table.tenantId, tenantId))
        .orderBy(...order),
  };
}

/**
 * بخش‌های خروجی، به ترتیب وابستگی: مرجع‌ها پیش از سندهایی که به آن‌ها ارجاع می‌دهند.
 *
 * **هر جدول دارای `tenant_id` باید یا اینجا باشد یا در `EXCLUDED_TENANT_TABLES`** —
 * آزمون e2e این را روی catalog واقعی PostgreSQL بررسی می‌کند، تا جدول تازه‌ای
 * بی‌صدا از خروجی جا نماند.
 */
export const TENANT_EXPORT_SECTIONS: readonly TenantExportSection[] = [
  tenantTable('settings', versionedSettings),
  tenantTable('memberships', tenantMemberships),
  {
    /*
     * کاربران سراسری‌اند و `tenant_id` ندارند. نقش برنامه فقط به `id` و
     * `display_name` دسترسی دارد (BE-065) — همان چیزی که خروجی لازم دارد؛
     * ایمیل و هش رمز اصلاً قابل خواندن نیستند. فقط کاربرانی که عضویتشان
     * (زیر RLS) در همین مستأجر است.
     */
    name: 'users',
    table: getTableName(users),
    read: (transaction) =>
      transaction
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(
          inArray(
            users.id,
            transaction.select({ userId: tenantMemberships.userId }).from(tenantMemberships),
          ),
        )
        .orderBy(asc(users.id)),
  },
  tenantTable('parties', parties),
  tenantTable('assetDimensions', assetDimensions),
  tenantTable('ledgerAccounts', ledgerAccounts),
  tenantTable('coinTypes', coinTypes),
  tenantTable('coinTypeVersions', coinTypeVersions),
  tenantTable('jewelryItems', jewelryItems),
  tenantTable('jewelryItemVersions', jewelryItemVersions),
  tenantTable('priceQuotes', priceQuotes),
  tenantTable('documentCounters', documentCounters),
  tenantTable('openingBalances', openingBalances),
  tenantTable('salesInvoices', salesInvoices),
  tenantTable('salesInvoiceVersions', salesInvoiceVersions),
  tenantTable('salesInvoiceItems', salesInvoiceItems),
  tenantTable('secondHandPurchases', secondHandPurchases),
  tenantTable('secondHandPurchaseItems', secondHandPurchaseItems),
  tenantTable('settlements', settlements),
  tenantTable('settlementLines', settlementLines),
  tenantTable('ledgerTransactions', ledgerTransactions),
  tenantTable('ledgerEntries', ledgerEntries),
  tenantTable('inventoryMovements', inventoryMovements),
  /*
   * «audit log مجاز»: رویدادها کامل، ولی شناسه‌ی شبکه‌ی کاربران (IP و
   * user agent) نه — داده‌ی امنیتی سکوست، نه داده‌ی کسب‌وکار مستأجر.
   * before/after از قبل هنگام ثبت از secret پاک شده‌اند (BE-014).
   */
  tenantTable('auditLogs', auditLogs, ['ipAddress', 'userAgent']),
];

/** جدول‌های مستأجرداری که عمداً در خروجی نیستند، با دلیل. */
export const EXCLUDED_TENANT_TABLES: Readonly<Record<string, string>> = {
  idempotency_records: 'حافظه‌ی پاسخ برای تکرار درخواست؛ کپی همان سندهایی است که خودشان صادر شده‌اند',
  refresh_tokens: 'هش توکن نشست — داده‌ی امنیتی، و نقش برنامه به آن دسترسی ندارد',
  rls_probes: 'جدول آزمون RLS، بدون داده‌ی کسب‌وکار',
  tenant_exports: 'خود خروجی‌ها؛ گنجاندنشان هر خروجی را به اندازه‌ی همه‌ی خروجی‌های قبلی بزرگ می‌کرد',
};
