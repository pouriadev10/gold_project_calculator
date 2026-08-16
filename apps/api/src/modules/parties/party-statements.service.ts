import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  assetDimensions,
  coinTypes,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  parties,
  priceQuotes,
  salesInvoiceVersions,
  salesInvoices,
  secondHandPurchases,
  settlementLines,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { PartyBalanceReferenceQuoteNotFoundError } from './party-balances.errors';
import { PartyNotFoundError } from './parties.service';
import type { Database } from '../../platform/database/connect';
import type { LedgerTransactionSourceType } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { PartyStatement, PartyStatementQuery } from '@gold/contracts';

type StatementEntry = PartyStatement['items'][number];
type StatementDimension = StatementEntry['dimension'];
type StatementRateSnapshot = StatementEntry['documentRateSnapshots'][number];

interface StatementEvent {
  readonly ledgerTransactionId: string;
  readonly sourceType: LedgerTransactionSourceType;
  readonly sourceId: string;
  readonly effectiveAt: Date;
  readonly createdAt: Date;
  readonly description: string;
  readonly dimension: StatementDimension;
  quantity: bigint;
  runningBalance: bigint;
}

function snapshotRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, unknown>>;
}

function snapshotIsoDate(value: unknown, key: string): string | null {
  const candidate = snapshotRecord(value)?.[key];
  if (typeof candidate !== 'string' || Number.isNaN(new Date(candidate).getTime())) return null;
  return candidate;
}

function sourceKey(type: LedgerTransactionSourceType, sourceId: string): string {
  return `${type}:${sourceId}`;
}

function eventRateKey(
  type: LedgerTransactionSourceType,
  sourceId: string,
  dimensionId: string,
): string {
  return `${sourceKey(type, sourceId)}:${dimensionId}`;
}

function settlementKey(settlementId: string, dimensionId: string): string {
  return `${settlementId}:${dimensionId}`;
}

function compareEvents(left: StatementEvent, right: StatementEvent): number {
  const effective = left.effectiveAt.getTime() - right.effectiveAt.getTime();
  if (effective !== 0) return effective;
  const created = left.createdAt.getTime() - right.createdAt.getTime();
  if (created !== 0) return created;
  const transaction = left.ledgerTransactionId.localeCompare(right.ledgerTransactionId);
  if (transaction !== 0) return transaction;
  return left.dimension.id.localeCompare(right.dimension.id);
}

/**
 * Read-only, tenant-isolated party statement. It projects append-only ledger
 * entries and never derives an accounting amount from a display mazneh.
 */
@Injectable()
export class PartyStatementsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getStatement(
    tenantId: string,
    partyId: string,
    query: Omit<PartyStatementQuery, 'from' | 'to'> & {
      readonly from?: Date | undefined;
      readonly to?: Date | undefined;
    },
  ): Promise<PartyStatement> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const [party] = await transaction
        .select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.tenantId, tenantId), eq(parties.id, partyId)))
        .limit(1);
      if (party === undefined) {
        throw new PartyNotFoundError();
      }

      const events = await this.loadEventsInTransaction(transaction, tenantId, partyId, query);
      const balancesByDimension = new Map<string, bigint>();
      for (const event of events) {
        const runningBalance = (balancesByDimension.get(event.dimension.id) ?? 0n) + event.quantity;
        balancesByDimension.set(event.dimension.id, runningBalance);
        event.runningBalance = runningBalance;
      }

      const visible = events.filter((event) => {
        if (query.from !== undefined && event.effectiveAt.getTime() < query.from.getTime()) {
          return false;
        }
        return query.sourceType === undefined || event.sourceType === query.sourceType;
      });
      const page = visible.slice(query.offset, query.offset + query.limit);
      const rateSnapshots = await this.loadDocumentRateSnapshotsInTransaction(
        transaction,
        tenantId,
        page,
      );
      const displayReferenceMazneh = await this.loadDisplayReferenceMaznehInTransaction(
        transaction,
        tenantId,
        query.referenceQuoteId,
      );

      return {
        partyId: party.id,
        displayReferenceMazneh,
        items: page.map((event) => ({
          ledgerTransactionId: event.ledgerTransactionId,
          source: { type: event.sourceType, id: event.sourceId },
          effectiveAt: event.effectiveAt.toISOString(),
          description: event.description,
          dimension: event.dimension,
          quantity: event.quantity.toString(),
          runningBalance: event.runningBalance.toString(),
          documentRateSnapshots: [
            ...(rateSnapshots.get(
              eventRateKey(event.sourceType, event.sourceId, event.dimension.id),
            ) ?? []),
          ],
        })),
        total: visible.length,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  private async loadEventsInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    partyId: string,
    query: { readonly to?: Date | undefined; readonly dimensionId?: string | undefined },
  ): Promise<StatementEvent[]> {
    const rows = await transaction
      .select({
        ledgerTransactionId: ledgerTransactions.id,
        sourceType: ledgerTransactions.sourceType,
        sourceId: ledgerTransactions.sourceId,
        effectiveAt: ledgerTransactions.effectiveAt,
        createdAt: ledgerTransactions.createdAt,
        description: ledgerTransactions.description,
        quantity: ledgerEntries.quantity,
        dimensionId: assetDimensions.id,
        dimensionCode: assetDimensions.code,
        dimensionKind: assetDimensions.kind,
        coinTypeId: assetDimensions.coinTypeId,
        coinCode: coinTypes.code,
      })
      .from(ledgerEntries)
      .innerJoin(
        ledgerAccounts,
        and(
          eq(ledgerEntries.tenantId, ledgerAccounts.tenantId),
          eq(ledgerEntries.accountId, ledgerAccounts.id),
        ),
      )
      .innerJoin(
        ledgerTransactions,
        and(
          eq(ledgerEntries.tenantId, ledgerTransactions.tenantId),
          eq(ledgerEntries.transactionId, ledgerTransactions.id),
        ),
      )
      .innerJoin(
        assetDimensions,
        and(
          eq(ledgerEntries.tenantId, assetDimensions.tenantId),
          eq(ledgerEntries.dimensionId, assetDimensions.id),
        ),
      )
      .leftJoin(
        coinTypes,
        and(
          eq(assetDimensions.tenantId, coinTypes.tenantId),
          eq(assetDimensions.coinTypeId, coinTypes.id),
        ),
      )
      .where(
        and(
          eq(ledgerEntries.tenantId, tenantId),
          eq(ledgerAccounts.partyId, partyId),
          query.to === undefined ? undefined : lte(ledgerTransactions.effectiveAt, query.to),
          query.dimensionId === undefined
            ? undefined
            : eq(ledgerEntries.dimensionId, query.dimensionId),
        ),
      )
      .orderBy(
        asc(ledgerTransactions.effectiveAt),
        asc(ledgerTransactions.createdAt),
        asc(ledgerTransactions.id),
        asc(assetDimensions.id),
      );

    const eventsByKey = new Map<string, StatementEvent>();
    for (const row of rows) {
      const key = `${row.ledgerTransactionId}:${row.dimensionId}`;
      const existing = eventsByKey.get(key);
      if (existing !== undefined) {
        existing.quantity += row.quantity;
        continue;
      }
      eventsByKey.set(key, {
        ledgerTransactionId: row.ledgerTransactionId,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        effectiveAt: row.effectiveAt,
        createdAt: row.createdAt,
        description: row.description,
        dimension: {
          id: row.dimensionId,
          code: row.dimensionCode,
          kind: row.dimensionKind,
          coinTypeId: row.coinTypeId,
          coinCode: row.coinCode,
        },
        quantity: row.quantity,
        runningBalance: 0n,
      });
    }

    return [...eventsByKey.values()].sort(compareEvents);
  }

  private async loadDocumentRateSnapshotsInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    events: readonly StatementEvent[],
  ): Promise<Map<string, readonly StatementRateSnapshot[]>> {
    const sourceIdsByType = new Map<LedgerTransactionSourceType, string[]>();
    for (const event of events) {
      const ids = sourceIdsByType.get(event.sourceType) ?? [];
      ids.push(event.sourceId);
      sourceIdsByType.set(event.sourceType, ids);
    }
    const uniqueIds = (type: LedgerTransactionSourceType): string[] => [
      ...new Set(sourceIdsByType.get(type) ?? []),
    ];
    const salesInvoiceIds = uniqueIds('SALES_INVOICE');
    const amendmentVersionIds = uniqueIds('SALES_INVOICE_AMENDMENT');
    const purchaseIds = uniqueIds('SECOND_HAND_PURCHASE');
    const settlementIds = uniqueIds('SETTLEMENT');
    const settlementDimensions = [
      ...new Set(
        events
          .filter((event) => event.sourceType === 'SETTLEMENT')
          .map((event) => event.dimension.id),
      ),
    ];

    const [sales, amendments, purchases, settlementRates] = await Promise.all([
      salesInvoiceIds.length === 0
        ? []
        : transaction
            .select({
              invoiceId: salesInvoices.id,
              quoteId: salesInvoices.quoteId,
              quoteAmountRial: salesInvoices.quoteAmountRial,
              quoteObservedAt: salesInvoices.quoteObservedAt,
              totalsSnapshot: salesInvoiceVersions.totalsSnapshot,
              settingsSnapshot: salesInvoiceVersions.settingsSnapshot,
            })
            .from(salesInvoices)
            .innerJoin(
              salesInvoiceVersions,
              and(
                eq(salesInvoices.tenantId, salesInvoiceVersions.tenantId),
                eq(salesInvoices.id, salesInvoiceVersions.salesInvoiceId),
                eq(salesInvoiceVersions.version, 1),
              ),
            )
            .where(
              and(eq(salesInvoices.tenantId, tenantId), inArray(salesInvoices.id, salesInvoiceIds)),
            ),
      amendmentVersionIds.length === 0
        ? []
        : transaction
            .select({
              versionId: salesInvoiceVersions.id,
              quoteId: salesInvoices.quoteId,
              quoteAmountRial: salesInvoices.quoteAmountRial,
              quoteObservedAt: salesInvoices.quoteObservedAt,
              totalsSnapshot: salesInvoiceVersions.totalsSnapshot,
              settingsSnapshot: salesInvoiceVersions.settingsSnapshot,
            })
            .from(salesInvoiceVersions)
            .innerJoin(
              salesInvoices,
              and(
                eq(salesInvoiceVersions.tenantId, salesInvoices.tenantId),
                eq(salesInvoiceVersions.salesInvoiceId, salesInvoices.id),
              ),
            )
            .where(
              and(
                eq(salesInvoiceVersions.tenantId, tenantId),
                inArray(salesInvoiceVersions.id, amendmentVersionIds),
              ),
            ),
      purchaseIds.length === 0
        ? []
        : transaction
            .select({
              id: secondHandPurchases.id,
              quoteId: secondHandPurchases.lockedQuoteId,
              quoteAmountRial: secondHandPurchases.lockedQuoteAmountRial,
              quoteObservedAt: secondHandPurchases.lockedQuoteObservedAt,
              pricingSnapshot: secondHandPurchases.settingsSnapshot,
            })
            .from(secondHandPurchases)
            .where(
              and(
                eq(secondHandPurchases.tenantId, tenantId),
                inArray(secondHandPurchases.id, purchaseIds),
              ),
            ),
      settlementIds.length === 0 || settlementDimensions.length === 0
        ? []
        : transaction
            .select({
              settlementId: settlementLines.settlementId,
              dimensionId: settlementLines.dimensionId,
              quoteId: settlementLines.lockedQuoteId,
              quoteAmountRial: settlementLines.lockedQuoteAmountRial,
              pricingSnapshot: settlementLines.lockedConversionSnapshot,
            })
            .from(settlementLines)
            .where(
              and(
                eq(settlementLines.tenantId, tenantId),
                inArray(settlementLines.settlementId, settlementIds),
                inArray(settlementLines.dimensionId, settlementDimensions),
              ),
            ),
    ]);

    const snapshotsBySource = new Map<string, StatementRateSnapshot[]>();
    const addSourceSnapshot = (
      type: LedgerTransactionSourceType,
      sourceId: string,
      snapshot: StatementRateSnapshot,
    ): void => {
      const key = sourceKey(type, sourceId);
      const existing = snapshotsBySource.get(key) ?? [];
      existing.push(snapshot);
      snapshotsBySource.set(key, existing);
    };
    for (const sale of sales) {
      addSourceSnapshot('SALES_INVOICE', sale.invoiceId, {
        quoteId: sale.quoteId,
        quoteAmountRial: sale.quoteAmountRial?.toString() ?? null,
        quoteObservedAt: sale.quoteObservedAt?.toISOString() ?? null,
        pricingSnapshot: { totals: sale.totalsSnapshot, settings: sale.settingsSnapshot },
      });
    }
    for (const amendment of amendments) {
      addSourceSnapshot('SALES_INVOICE_AMENDMENT', amendment.versionId, {
        quoteId: amendment.quoteId,
        quoteAmountRial: amendment.quoteAmountRial?.toString() ?? null,
        quoteObservedAt: amendment.quoteObservedAt?.toISOString() ?? null,
        pricingSnapshot: { totals: amendment.totalsSnapshot, settings: amendment.settingsSnapshot },
      });
    }
    for (const purchase of purchases) {
      addSourceSnapshot('SECOND_HAND_PURCHASE', purchase.id, {
        quoteId: purchase.quoteId,
        quoteAmountRial: purchase.quoteAmountRial.toString(),
        quoteObservedAt: purchase.quoteObservedAt.toISOString(),
        pricingSnapshot: purchase.pricingSnapshot,
      });
    }
    const snapshotsByEvent = new Map<string, StatementRateSnapshot[]>();
    for (const event of events) {
      if (event.sourceType === 'SETTLEMENT') continue;
      const sourceSnapshots = snapshotsBySource.get(sourceKey(event.sourceType, event.sourceId));
      if (sourceSnapshots !== undefined) {
        snapshotsByEvent.set(eventRateKey(event.sourceType, event.sourceId, event.dimension.id), [
          ...sourceSnapshots,
        ]);
      }
    }

    const settlementRatesByKey = new Map<string, (typeof settlementRates)[number][]>();
    for (const rate of settlementRates) {
      const key = settlementKey(rate.settlementId, rate.dimensionId);
      const existing = settlementRatesByKey.get(key) ?? [];
      existing.push(rate);
      settlementRatesByKey.set(key, existing);
    }
    for (const event of events) {
      if (event.sourceType !== 'SETTLEMENT') continue;
      const rates =
        settlementRatesByKey.get(settlementKey(event.sourceId, event.dimension.id)) ?? [];
      const rateSnapshots = rates.flatMap((rate): StatementRateSnapshot[] => {
        if (rate.quoteId === null || rate.quoteAmountRial === null) return [];
        return [
          {
            quoteId: rate.quoteId,
            quoteAmountRial: rate.quoteAmountRial.toString(),
            quoteObservedAt: snapshotIsoDate(rate.pricingSnapshot, 'quoteObservedAt'),
            pricingSnapshot: rate.pricingSnapshot,
          },
        ];
      });
      if (rateSnapshots.length > 0) {
        snapshotsByEvent.set(
          eventRateKey(event.sourceType, event.sourceId, event.dimension.id),
          rateSnapshots,
        );
      }
    }

    return snapshotsByEvent;
  }

  private async loadDisplayReferenceMaznehInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    referenceQuoteId: string | undefined,
  ): Promise<PartyStatement['displayReferenceMazneh']> {
    if (referenceQuoteId === undefined) return null;

    const [quote] = await transaction
      .select()
      .from(priceQuotes)
      .where(and(eq(priceQuotes.tenantId, tenantId), eq(priceQuotes.id, referenceQuoteId)))
      .limit(1);
    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new PartyBalanceReferenceQuoteNotFoundError();
    }

    return {
      id: quote.id,
      amountRial: quote.amountRial.toString(),
      observedAt: quote.observedAt.toISOString(),
    };
  }
}
