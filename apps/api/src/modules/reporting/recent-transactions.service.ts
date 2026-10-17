import { Inject, Injectable } from '@nestjs/common';
import { dualFromRial } from '@gold/core-calc';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  coinTypeVersions,
  jewelryItemVersions,
  parties,
  salesInvoiceItems,
  salesInvoiceVersions,
  salesInvoices,
  secondHandPurchaseItems,
  secondHandPurchases,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import {
  LockedSnapshotInvalidError,
  lockedGoldRate1000,
  snapshotDigits,
  snapshotUuid,
  type LockedSnapshotValue,
} from '../pricing/locked-gold-rate';
import type { RecentTransaction, RecentTransactionList } from '@gold/contracts';
import type { Database } from '../../platform/database/connect';
import type { PartyType } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

const PERSIAN_INTEGER = new Intl.NumberFormat('fa-IR', { useGrouping: false });

/** «۲ ربع سکه بهار آزادی» — سکه شمارشی است و با تعدادش نام برده می‌شود. */
function coinTitle(count: number, title: string): string {
  return `${PERSIAN_INTEGER.format(count)} ${title}`;
}

function signedAmount(rialAmount: bigint, rate1000: bigint): RecentTransaction['amount'] {
  const dual = dualFromRial(rialAmount, rate1000);
  return { rial: dual.rial.toString(), pureMg: dual.pureMg.toString(), rate1000: dual.rate1000.toString() };
}

export interface RecentSaleRow {
  readonly id: string;
  readonly partyName: string;
  readonly occurredAt: Date;
  readonly quoteAmountRial: bigint;
  readonly totalsSnapshot: LockedSnapshotValue;
  readonly settingsSnapshot: LockedSnapshotValue;
  /** Current version's line (phase 1: one line per invoice). */
  readonly line: { readonly itemType: 'JEWELRY' | 'COIN'; readonly quantity: number; readonly title: string };
}

export interface RecentPurchaseRow {
  readonly id: string;
  readonly partyName: string;
  readonly partyType: PartyType;
  readonly isBuyback: boolean;
  readonly occurredAt: Date;
  readonly lockedQuoteAmountRial: bigint;
  readonly finalAmountRial: bigint;
  readonly settingsSnapshot: LockedSnapshotValue;
  /** Coin line, when the purchase acquired coins; gold purchases have none. */
  readonly coin: { readonly count: number; readonly title: string } | null;
}

/** A finalized sale: money in (positive), at the gram-1000 rate locked at finalization. */
export function toRecentSale(row: RecentSaleRow): RecentTransaction {
  const payableRial = snapshotDigits(row.totalsSnapshot, 'payableRial');
  if (payableRial === null) {
    throw new LockedSnapshotInvalidError(`sales invoice ${row.id} totals snapshot.payableRial is missing`);
  }
  return {
    id: row.id,
    partyName: row.partyName,
    kind: row.line.itemType === 'COIN' ? 'coin-sale' : 'sale',
    title: row.line.itemType === 'COIN' ? coinTitle(row.line.quantity, row.line.title) : row.line.title,
    amount: signedAmount(BigInt(payableRial), lockedGoldRate1000(row.quoteAmountRial, row.settingsSnapshot)),
    occurredAt: row.occurredAt.toISOString(),
  };
}

/**
 * A purchase: money out (negative). From a consumer it is a second-hand
 * purchase (a B2C return included — rule 2-5: it is a purchase, not a return);
 * from a business counterparty it is a plain purchase.
 */
export function toRecentPurchase(row: RecentPurchaseRow): RecentTransaction {
  const goldTitle = row.isBuyback ? 'مرجوعی — خرید طلای دست‌دوم' : 'خرید طلای دست‌دوم';
  return {
    id: row.id,
    partyName: row.partyName,
    kind: row.partyType === 'BUSINESS' ? 'purchase' : 'second-hand',
    title: row.coin === null ? goldTitle : `خرید ${coinTitle(row.coin.count, row.coin.title)}`,
    amount: signedAmount(-row.finalAmountRial, lockedGoldRate1000(row.lockedQuoteAmountRial, row.settingsSnapshot)),
    occurredAt: row.occurredAt.toISOString(),
  };
}

/** Newest first; equal instants fall back to id so the order is stable. */
export function mergeRecent(items: readonly RecentTransaction[], limit: number): RecentTransaction[] {
  return [...items]
    .sort((left, right) => {
      const byTime = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
    })
    .slice(0, limit);
}

/**
 * Last N commercial documents for the home screen — FE-106b. Read-only and
 * tenant-scoped (RLS). Settlements are payments against a balance, not trades,
 * and are intentionally excluded.
 */
@Injectable()
export class RecentTransactionsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async recent(tenantId: string, limit: number): Promise<RecentTransactionList> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const [sales, purchases] = await Promise.all([
        this.recentSales(transaction, tenantId, limit),
        this.recentPurchases(transaction, tenantId, limit),
      ]);
      return { items: mergeRecent([...sales.map(toRecentSale), ...purchases.map(toRecentPurchase)], limit) };
    });
  }

  private async recentSales(
    transaction: TenantTransaction,
    tenantId: string,
    limit: number,
  ): Promise<RecentSaleRow[]> {
    const invoices = await transaction
      .select({
        id: salesInvoices.id,
        partyName: parties.displayName,
        finalizedAt: salesInvoices.finalizedAt,
        quoteAmountRial: salesInvoices.quoteAmountRial,
        versionId: salesInvoiceVersions.id,
        totalsSnapshot: salesInvoiceVersions.totalsSnapshot,
        settingsSnapshot: salesInvoiceVersions.settingsSnapshot,
      })
      .from(salesInvoices)
      .innerJoin(
        parties,
        and(eq(parties.tenantId, salesInvoices.tenantId), eq(parties.id, salesInvoices.partyId)),
      )
      .innerJoin(
        salesInvoiceVersions,
        and(
          eq(salesInvoiceVersions.tenantId, salesInvoices.tenantId),
          eq(salesInvoiceVersions.salesInvoiceId, salesInvoices.id),
          eq(salesInvoiceVersions.version, salesInvoices.currentVersion),
        ),
      )
      .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.status, 'FINALIZED')))
      .orderBy(desc(salesInvoices.finalizedAt), desc(salesInvoices.id))
      .limit(limit);
    if (invoices.length === 0) return [];

    const lines = await transaction
      .select()
      .from(salesInvoiceItems)
      .where(
        and(
          eq(salesInvoiceItems.tenantId, tenantId),
          inArray(
            salesInvoiceItems.salesInvoiceVersionId,
            invoices.map((invoice) => invoice.versionId),
          ),
        ),
      );
    const titles = await this.itemVersionTitles(
      transaction,
      tenantId,
      lines.flatMap((line) => snapshotUuid(line.lineSnapshot, 'jewelryItemVersionId') ?? []),
      lines.flatMap((line) => snapshotUuid(line.lineSnapshot, 'coinTypeVersionId') ?? []),
    );

    return invoices.map((invoice) => {
      const line = lines.find((candidate) => candidate.salesInvoiceVersionId === invoice.versionId);
      const versionId =
        line === undefined
          ? undefined
          : snapshotUuid(line.lineSnapshot, line.itemType === 'JEWELRY' ? 'jewelryItemVersionId' : 'coinTypeVersionId');
      const title = versionId === undefined ? undefined : titles.get(versionId);
      if (line === undefined || title === undefined || invoice.finalizedAt === null || invoice.quoteAmountRial === null) {
        throw new LockedSnapshotInvalidError(`finalized sales invoice ${invoice.id} has no priced line`);
      }
      return {
        id: invoice.id,
        partyName: invoice.partyName,
        occurredAt: invoice.finalizedAt,
        quoteAmountRial: invoice.quoteAmountRial,
        totalsSnapshot: invoice.totalsSnapshot,
        settingsSnapshot: invoice.settingsSnapshot,
        line: { itemType: line.itemType, quantity: line.quantity, title },
      };
    });
  }

  private async recentPurchases(
    transaction: TenantTransaction,
    tenantId: string,
    limit: number,
  ): Promise<RecentPurchaseRow[]> {
    const purchases = await transaction
      .select({
        id: secondHandPurchases.id,
        partyName: parties.displayName,
        partyType: parties.type,
        sourceInvoiceId: secondHandPurchases.sourceInvoiceId,
        effectiveAt: secondHandPurchases.effectiveAt,
        lockedQuoteAmountRial: secondHandPurchases.lockedQuoteAmountRial,
        finalAmountRial: secondHandPurchases.finalAmountRial,
        settingsSnapshot: secondHandPurchases.settingsSnapshot,
      })
      .from(secondHandPurchases)
      .innerJoin(
        parties,
        and(eq(parties.tenantId, secondHandPurchases.tenantId), eq(parties.id, secondHandPurchases.partyId)),
      )
      .where(eq(secondHandPurchases.tenantId, tenantId))
      .orderBy(desc(secondHandPurchases.effectiveAt), desc(secondHandPurchases.id))
      .limit(limit);
    if (purchases.length === 0) return [];

    const coinLines = await transaction
      .select({
        secondHandPurchaseId: secondHandPurchaseItems.secondHandPurchaseId,
        coinCount: secondHandPurchaseItems.coinCount,
      })
      .from(secondHandPurchaseItems)
      .where(
        and(
          eq(secondHandPurchaseItems.tenantId, tenantId),
          eq(secondHandPurchaseItems.itemType, 'COIN'),
          inArray(
            secondHandPurchaseItems.secondHandPurchaseId,
            purchases.map((purchase) => purchase.id),
          ),
        ),
      );
    const coinVersionByPurchase = new Map(
      purchases.flatMap((purchase) => {
        const versionId = snapshotUuid(purchase.settingsSnapshot, 'coinTypeVersionId');
        return versionId === undefined ? [] : [[purchase.id, versionId] as const];
      }),
    );
    const titles = await this.itemVersionTitles(transaction, tenantId, [], [...coinVersionByPurchase.values()]);

    return purchases.map((purchase) => {
      const coinLine = coinLines.find((line) => line.secondHandPurchaseId === purchase.id);
      let coin: RecentPurchaseRow['coin'] = null;
      if (coinLine !== undefined) {
        const versionId = coinVersionByPurchase.get(purchase.id);
        const title = versionId === undefined ? undefined : titles.get(versionId);
        if (title === undefined || coinLine.coinCount === null) {
          throw new LockedSnapshotInvalidError(`coin purchase ${purchase.id} has no coin type version`);
        }
        coin = { count: coinLine.coinCount, title };
      }
      return {
        id: purchase.id,
        partyName: purchase.partyName,
        partyType: purchase.partyType,
        isBuyback: purchase.sourceInvoiceId !== null,
        occurredAt: purchase.effectiveAt,
        lockedQuoteAmountRial: purchase.lockedQuoteAmountRial,
        finalAmountRial: purchase.finalAmountRial,
        settingsSnapshot: purchase.settingsSnapshot,
        coin,
      };
    });
  }

  /** Titles of the exact item versions the documents were priced with. */
  private async itemVersionTitles(
    transaction: TenantTransaction,
    tenantId: string,
    jewelryVersionIds: readonly string[],
    coinVersionIds: readonly string[],
  ): Promise<Map<string, string>> {
    const [jewelry, coins] = await Promise.all([
      jewelryVersionIds.length === 0
        ? []
        : transaction
            .select({ id: jewelryItemVersions.id, title: jewelryItemVersions.title })
            .from(jewelryItemVersions)
            .where(
              and(
                eq(jewelryItemVersions.tenantId, tenantId),
                inArray(jewelryItemVersions.id, [...jewelryVersionIds]),
              ),
            ),
      coinVersionIds.length === 0
        ? []
        : transaction
            .select({ id: coinTypeVersions.id, title: coinTypeVersions.title })
            .from(coinTypeVersions)
            .where(and(eq(coinTypeVersions.tenantId, tenantId), inArray(coinTypeVersions.id, [...coinVersionIds]))),
    ]);
    return new Map([...jewelry, ...coins].map((version) => [version.id, version.title] as const));
  }
}
