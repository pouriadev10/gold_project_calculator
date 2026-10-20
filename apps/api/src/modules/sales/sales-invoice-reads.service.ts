import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  coinTypeVersions,
  jewelryItemVersions,
  ledgerEntries,
  ledgerTransactions,
  parties,
  salesInvoiceItems,
  salesInvoiceVersions,
  salesInvoices,
  users,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { likeContainsPattern, normalizeTextForSearch } from '../../shared/validation';
import {
  LockedSnapshotInvalidError,
  lockedGoldRate1000,
  snapshotDigits,
  snapshotMithqalGramsX10k,
  snapshotText,
  snapshotUuid,
} from '../pricing/locked-gold-rate';
import { SalesInvoiceNotFoundError } from './sales-invoices.errors';
import type {
  SalesInvoiceDetail,
  SalesInvoiceList,
  SalesInvoiceListItem,
  SalesInvoiceListQuery,
} from '@gold/contracts';
import type { Database } from '../../platform/database/connect';
import type {
  PartyStatus,
  PartyType,
  SalesInvoiceItemType,
  SalesInvoiceSnapshotValue,
  SalesInvoiceStatus,
} from '../../platform/database/schema';

type DetailVersion = SalesInvoiceDetail['versions'][number];
type DetailItem = DetailVersion['items'][number];

function requiredDigits(value: SalesInvoiceSnapshotValue, key: string, context: string): string {
  const digits = snapshotDigits(value, key);
  if (digits === null) {
    throw new LockedSnapshotInvalidError(`${context}.${key} must be a non-negative integer string`);
  }
  return digits;
}

/** Event time of an invoice: its locked finalization time, or creation for a draft. */
function occurredAt(row: { readonly finalizedAt: Date | null; readonly createdAt: Date }): string {
  return (row.finalizedAt ?? row.createdAt).toISOString();
}

/* ── list ─────────────────────────────────────────────────────── */

export interface SalesInvoiceListRow {
  readonly id: string;
  readonly invoiceNumber: number | null;
  readonly invoicePeriod: string | null;
  readonly status: SalesInvoiceStatus;
  readonly currentVersion: number;
  readonly partyId: string;
  readonly partyDisplayName: string;
  readonly quoteAmountRial: bigint | null;
  readonly finalizedAt: Date | null;
  readonly createdAt: Date;
  /** Current version's snapshots; `null` only for a draft (no version yet). */
  readonly totalsSnapshot: SalesInvoiceSnapshotValue | null;
  readonly settingsSnapshot: SalesInvoiceSnapshotValue | null;
}

/**
 * One list row. A finalized invoice carries its current version's payable and
 * the gram-1000 rate locked at finalization, so the unit toggle never needs
 * today's mazneh. A draft has neither and stays `null`.
 */
export function toSalesInvoiceListItem(row: SalesInvoiceListRow): SalesInvoiceListItem {
  const base = {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    invoicePeriod: row.invoicePeriod,
    status: row.status,
    currentVersion: row.currentVersion,
    party: { id: row.partyId, displayName: row.partyDisplayName },
    occurredAt: occurredAt(row),
  };
  if (row.status === 'DRAFT') {
    return { ...base, payableRial: null, goldRatePerGramRial: null };
  }
  if (row.quoteAmountRial === null || row.totalsSnapshot === null || row.settingsSnapshot === null) {
    throw new LockedSnapshotInvalidError(`finalized invoice ${row.id} has no current version or quote`);
  }
  return {
    ...base,
    payableRial: requiredDigits(row.totalsSnapshot, 'payableRial', 'totals snapshot'),
    goldRatePerGramRial: lockedGoldRate1000(row.quoteAmountRial, row.settingsSnapshot).toString(),
  };
}

/* ── detail ───────────────────────────────────────────────────── */

export interface SalesInvoiceDetailHeader {
  readonly id: string;
  readonly invoiceNumber: number | null;
  readonly invoicePeriod: string | null;
  readonly status: SalesInvoiceStatus;
  readonly currentVersion: number;
  readonly finalizedAt: Date | null;
  readonly createdAt: Date;
  readonly quoteAmountRial: bigint | null;
  readonly quoteObservedAt: Date | null;
  readonly party: {
    readonly id: string;
    readonly displayName: string;
    readonly type: PartyType;
    readonly status: PartyStatus;
  };
}

export interface SalesInvoiceDetailVersionRow {
  readonly id: string;
  readonly version: number;
  readonly reason: string | null;
  readonly reasonDetail: string | null;
  readonly createdAt: Date;
  readonly totalsSnapshot: SalesInvoiceSnapshotValue;
  readonly settingsSnapshot: SalesInvoiceSnapshotValue;
  readonly actor: { readonly id: string; readonly displayName: string } | null;
}

export interface SalesInvoiceDetailItemRow {
  readonly salesInvoiceVersionId: string;
  readonly itemType: SalesInvoiceItemType;
  readonly itemId: string;
  readonly quantity: number;
  readonly lineSnapshot: SalesInvoiceSnapshotValue;
  /** Title and karat of the item version the line was priced with. */
  readonly title: string | undefined;
  readonly karat: number | null;
}

export interface SalesInvoiceLedgerTransactionRow {
  readonly version: number;
  readonly entries: readonly { readonly dimensionId: string; readonly quantity: bigint }[];
}

function toDetailItem(item: SalesInvoiceDetailItemRow): DetailItem {
  if (item.title === undefined || item.title.trim().length === 0) {
    throw new LockedSnapshotInvalidError(`invoice line for item ${item.itemId} has no item version title`);
  }
  return {
    itemType: item.itemType,
    itemId: item.itemId,
    title: item.title,
    quantity: BigInt(item.quantity).toString(),
    // سکه شمارشی است و هرگز وزن ندارد (قاعده‌ی ۲-۲)
    pureWeightMg: item.itemType === 'JEWELRY' ? snapshotDigits(item.lineSnapshot, 'pureWeightMg') : null,
    karat: item.karat,
    payableRial: requiredDigits(item.lineSnapshot, 'payableRial', 'line snapshot'),
  };
}

function totalPureWeightMg(items: readonly DetailItem[]): string | null {
  const weights = items.flatMap((item) => (item.pureWeightMg === null ? [] : [BigInt(item.pureWeightMg)]));
  return weights.length === 0 ? null : weights.reduce((sum, weight) => sum + weight, 0n).toString();
}

function ledgerSummary(transactions: readonly SalesInvoiceLedgerTransactionRow[]): DetailVersion['ledgerSummary'] {
  let entryCount = 0;
  let balanced = true;
  for (const transaction of transactions) {
    entryCount += transaction.entries.length;
    const byDimension = new Map<string, bigint>();
    for (const entry of transaction.entries) {
      byDimension.set(entry.dimensionId, (byDimension.get(entry.dimensionId) ?? 0n) + entry.quantity);
    }
    if ([...byDimension.values()].some((sum) => sum !== 0n)) balanced = false;
  }
  return { transactionCount: transactions.length, entryCount, balanced };
}

function toDetailVersion(
  version: SalesInvoiceDetailVersionRow,
  items: readonly SalesInvoiceDetailItemRow[],
  ledger: readonly SalesInvoiceLedgerTransactionRow[],
): DetailVersion {
  const payableRial = requiredDigits(version.totalsSnapshot, 'payableRial', 'totals snapshot');
  // فروش نقدی paid/receivable ندارد: تمام مبلغ همان لحظه دریافت شده است
  const paidRial = snapshotDigits(version.totalsSnapshot, 'paidRial') ?? payableRial;
  if (BigInt(paidRial) > BigInt(payableRial)) {
    throw new LockedSnapshotInvalidError(`invoice version ${version.version} paid exceeds payable`);
  }
  const receivableRial =
    snapshotDigits(version.totalsSnapshot, 'receivableRial') ??
    (BigInt(payableRial) - BigInt(paidRial)).toString();
  const detailItems = items.map(toDetailItem);
  return {
    version: version.version,
    reason: version.reason,
    reasonDetail: version.reasonDetail,
    actor: version.actor,
    createdAt: version.createdAt.toISOString(),
    payableRial,
    paidRial,
    receivableRial,
    pureWeightMg: totalPureWeightMg(detailItems),
    items: detailItems,
    settingsSnapshot: {
      baseQuoteKarat: snapshotDigits(version.settingsSnapshot, 'baseQuoteKarat'),
      mithqalGramsX10k: snapshotMithqalGramsX10k(version.settingsSnapshot),
      roundingUnitRial: snapshotDigits(version.settingsSnapshot, 'roundingUnitRial'),
      roundingPolicy: snapshotText(version.settingsSnapshot, 'roundingPolicy'),
      profitRateBps: snapshotDigits(version.settingsSnapshot, 'profitRateBps'),
      taxRateBps: snapshotDigits(version.settingsSnapshot, 'taxRateBps'),
    },
    ledgerSummary: ledgerSummary(ledger.filter((transaction) => transaction.version === version.version)),
  };
}

/**
 * Detail projection: every amount, weight and setting comes from the immutable
 * version snapshots; the quote snapshot's gram-1000 rate is re-derived from the
 * locked mazneh with the current version's own settings snapshot — never from
 * today's settings.
 */
export function toSalesInvoiceDetail(
  header: SalesInvoiceDetailHeader,
  versions: readonly SalesInvoiceDetailVersionRow[],
  items: readonly SalesInvoiceDetailItemRow[],
  ledger: readonly SalesInvoiceLedgerTransactionRow[],
): SalesInvoiceDetail {
  const base = {
    id: header.id,
    invoiceNumber: header.invoiceNumber,
    invoicePeriod: header.invoicePeriod,
    status: header.status,
    currentVersion: header.currentVersion,
    party: header.party,
    occurredAt: occurredAt(header),
  };
  if (header.status === 'DRAFT') {
    return { ...base, quoteSnapshot: null, versions: [] };
  }

  const current = versions.find((version) => version.version === header.currentVersion);
  if (current === undefined || header.quoteAmountRial === null || header.quoteObservedAt === null) {
    throw new LockedSnapshotInvalidError(`finalized invoice ${header.id} has no current version or quote`);
  }
  return {
    ...base,
    quoteSnapshot: {
      amountRial: header.quoteAmountRial.toString(),
      goldRatePerGramRial: lockedGoldRate1000(header.quoteAmountRial, current.settingsSnapshot).toString(),
      observedAt: header.quoteObservedAt.toISOString(),
    },
    versions: [...versions]
      .sort((left, right) => left.version - right.version)
      .map((version) =>
        toDetailVersion(
          version,
          items.filter((item) => item.salesInvoiceVersionId === version.id),
          ledger,
        ),
      ),
  };
}

/* ── service ──────────────────────────────────────────────────── */

/**
 * Read-only, tenant-scoped (RLS) invoice list and detail — FE-106b. Nothing
 * here writes; every figure is the document's own snapshot.
 */
@Injectable()
export class SalesInvoiceReadsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(tenantId: string, query: SalesInvoiceListQuery): Promise<SalesInvoiceList> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const eventAt = sql`coalesce(${salesInvoices.finalizedAt}, ${salesInvoices.createdAt})`;
      const conditions = [eq(salesInvoices.tenantId, tenantId)];
      if (query.invoiceNumber !== undefined) {
        // فقط رقم و یک خط تیره است (قرارداد)، پس wildcard ِ ناخواسته‌ای وارد LIKE نمی‌شود.
        // روی شناسه‌ی کامل «دوره-شماره» (D-02): «12» همه‌ی سال‌ها و «1405-12» فقط همان را می‌یابد.
        conditions.push(
          sql`(${salesInvoices.invoicePeriod} || '-' || ${salesInvoices.invoiceNumber}::text) like ${`%${query.invoiceNumber}%`}`,
        );
      }
      if (query.partySearch !== undefined) {
        conditions.push(ilike(parties.normalizedName, likeContainsPattern(normalizeTextForSearch(query.partySearch))));
      }
      if (query.status !== undefined) {
        conditions.push(eq(salesInvoices.status, query.status));
      }
      if (query.from !== undefined) {
        conditions.push(sql`${eventAt} >= ${query.from}::timestamptz`);
      }
      if (query.to !== undefined) {
        conditions.push(sql`${eventAt} <= ${query.to}::timestamptz`);
      }
      const where = and(...conditions);
      const partyJoin = and(
        eq(parties.tenantId, salesInvoices.tenantId),
        eq(parties.id, salesInvoices.partyId),
      );

      const [rows, counted] = await Promise.all([
        transaction
          .select({
            id: salesInvoices.id,
            invoiceNumber: salesInvoices.invoiceNumber,
            invoicePeriod: salesInvoices.invoicePeriod,
            status: salesInvoices.status,
            currentVersion: salesInvoices.currentVersion,
            partyId: parties.id,
            partyDisplayName: parties.displayName,
            quoteAmountRial: salesInvoices.quoteAmountRial,
            finalizedAt: salesInvoices.finalizedAt,
            createdAt: salesInvoices.createdAt,
            totalsSnapshot: salesInvoiceVersions.totalsSnapshot,
            settingsSnapshot: salesInvoiceVersions.settingsSnapshot,
          })
          .from(salesInvoices)
          .innerJoin(parties, partyJoin)
          .leftJoin(
            salesInvoiceVersions,
            and(
              eq(salesInvoiceVersions.tenantId, salesInvoices.tenantId),
              eq(salesInvoiceVersions.salesInvoiceId, salesInvoices.id),
              eq(salesInvoiceVersions.version, salesInvoices.currentVersion),
            ),
          )
          .where(where)
          .orderBy(desc(eventAt), desc(salesInvoices.id))
          .limit(query.limit)
          .offset(query.offset),
        transaction.select({ total: count() }).from(salesInvoices).innerJoin(parties, partyJoin).where(where),
      ]);

      return {
        items: rows.map(toSalesInvoiceListItem),
        total: counted[0]!.total,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  async detail(tenantId: string, invoiceId: string): Promise<SalesInvoiceDetail> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const [header] = await transaction
        .select({
          id: salesInvoices.id,
          invoiceNumber: salesInvoices.invoiceNumber,
          invoicePeriod: salesInvoices.invoicePeriod,
          status: salesInvoices.status,
          currentVersion: salesInvoices.currentVersion,
          finalizedAt: salesInvoices.finalizedAt,
          createdAt: salesInvoices.createdAt,
          quoteAmountRial: salesInvoices.quoteAmountRial,
          quoteObservedAt: salesInvoices.quoteObservedAt,
          partyId: parties.id,
          partyDisplayName: parties.displayName,
          partyType: parties.type,
          partyStatus: parties.status,
        })
        .from(salesInvoices)
        .innerJoin(
          parties,
          and(eq(parties.tenantId, salesInvoices.tenantId), eq(parties.id, salesInvoices.partyId)),
        )
        .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, invoiceId)))
        .limit(1);
      if (header === undefined) {
        throw new SalesInvoiceNotFoundError(invoiceId);
      }
      const detailHeader: SalesInvoiceDetailHeader = {
        ...header,
        party: {
          id: header.partyId,
          displayName: header.partyDisplayName,
          type: header.partyType,
          status: header.partyStatus,
        },
      };
      if (header.status === 'DRAFT') {
        return toSalesInvoiceDetail(detailHeader, [], [], []);
      }

      const versionRows = await transaction
        .select({ version: salesInvoiceVersions, actorId: users.id, actorDisplayName: users.displayName })
        .from(salesInvoiceVersions)
        .leftJoin(users, eq(users.id, salesInvoiceVersions.createdBy))
        .where(
          and(
            eq(salesInvoiceVersions.tenantId, tenantId),
            eq(salesInvoiceVersions.salesInvoiceId, invoiceId),
          ),
        )
        .orderBy(salesInvoiceVersions.version);
      const versions: SalesInvoiceDetailVersionRow[] = versionRows.map(
        ({ version, actorId, actorDisplayName }) => ({
          id: version.id,
          version: version.version,
          reason: version.reason,
          reasonDetail: version.reasonDetail,
          createdAt: version.createdAt,
          totalsSnapshot: version.totalsSnapshot,
          settingsSnapshot: version.settingsSnapshot,
          actor:
            actorId === null || actorDisplayName === null
              ? null
              : { id: actorId, displayName: actorDisplayName },
        }),
      );
      const versionIds = versions.map((version) => version.id);

      const items = await transaction
        .select()
        .from(salesInvoiceItems)
        .where(
          and(eq(salesInvoiceItems.tenantId, tenantId), eq(salesInvoiceItems.salesInvoiceId, invoiceId)),
        );
      const jewelryVersionIds = items
        .filter((item) => item.itemType === 'JEWELRY')
        .flatMap((item) => snapshotUuid(item.lineSnapshot, 'jewelryItemVersionId') ?? []);
      const coinVersionIds = items
        .filter((item) => item.itemType === 'COIN')
        .flatMap((item) => snapshotUuid(item.lineSnapshot, 'coinTypeVersionId') ?? []);
      const [jewelryVersions, coinVersions] = await Promise.all([
        jewelryVersionIds.length === 0
          ? []
          : transaction
              .select({ id: jewelryItemVersions.id, title: jewelryItemVersions.title, karat: jewelryItemVersions.karat })
              .from(jewelryItemVersions)
              .where(
                and(
                  eq(jewelryItemVersions.tenantId, tenantId),
                  inArray(jewelryItemVersions.id, jewelryVersionIds),
                ),
              ),
        coinVersionIds.length === 0
          ? []
          : transaction
              .select({ id: coinTypeVersions.id, title: coinTypeVersions.title, karat: coinTypeVersions.karat })
              .from(coinTypeVersions)
              .where(
                and(eq(coinTypeVersions.tenantId, tenantId), inArray(coinTypeVersions.id, coinVersionIds)),
              ),
      ]);
      const itemVersions = new Map(
        [...jewelryVersions, ...coinVersions].map((version) => [version.id, version] as const),
      );
      const itemRows: SalesInvoiceDetailItemRow[] = items.map((item) => {
        const versionId = snapshotUuid(
          item.lineSnapshot,
          item.itemType === 'JEWELRY' ? 'jewelryItemVersionId' : 'coinTypeVersionId',
        );
        const itemVersion = versionId === undefined ? undefined : itemVersions.get(versionId);
        return {
          salesInvoiceVersionId: item.salesInvoiceVersionId,
          itemType: item.itemType,
          itemId: item.itemId,
          quantity: item.quantity,
          lineSnapshot: item.lineSnapshot,
          title: itemVersion?.title,
          karat: itemVersion?.karat ?? null,
        };
      });

      const transactions = await transaction
        .select({
          id: ledgerTransactions.id,
          sourceType: ledgerTransactions.sourceType,
          sourceId: ledgerTransactions.sourceId,
        })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenantId),
            or(
              and(eq(ledgerTransactions.sourceType, 'SALES_INVOICE'), eq(ledgerTransactions.sourceId, invoiceId)),
              versionIds.length === 0
                ? undefined
                : and(
                    eq(ledgerTransactions.sourceType, 'SALES_INVOICE_AMENDMENT'),
                    inArray(ledgerTransactions.sourceId, versionIds),
                  ),
            ),
          ),
        );
      const transactionIds = transactions.map((entry) => entry.id);
      const entries =
        transactionIds.length === 0
          ? []
          : await transaction
              .select({
                transactionId: ledgerEntries.transactionId,
                dimensionId: ledgerEntries.dimensionId,
                quantity: ledgerEntries.quantity,
              })
              .from(ledgerEntries)
              .where(
                and(eq(ledgerEntries.tenantId, tenantId), inArray(ledgerEntries.transactionId, transactionIds)),
              );
      const versionNumberById = new Map(versions.map((version) => [version.id, version.version]));
      const ledger = transactions.flatMap((entry): SalesInvoiceLedgerTransactionRow[] => {
        const version =
          entry.sourceType === 'SALES_INVOICE' ? 1 : versionNumberById.get(entry.sourceId);
        if (version === undefined) return [];
        return [
          {
            version,
            entries: entries.filter((ledgerEntry) => ledgerEntry.transactionId === entry.id),
          },
        ];
      });

      return toSalesInvoiceDetail(detailHeader, versions, itemRows, ledger);
    });
  }
}
