import { Inject, Injectable } from '@nestjs/common';
import {
  dualFromPure,
  dualFromRial,
  gramRate1000,
  karat,
  pureMg,
  rateDivisorFromMarketSettings,
  rial,
  valueOfPure,
} from '@gold/core-calc';
import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  coinTypeVersions,
  secondHandPurchases,
  salesInvoiceItems,
  salesInvoiceVersions,
  salesInvoices,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { ProfitReportSnapshotInvalidError } from './reporting.errors';
import type {
  SalesInvoiceSnapshotValue,
  SecondHandPurchaseSnapshotValue,
} from '../../platform/database/schema';
import type { Database } from '../../platform/database/connect';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { ProfitReport, ProfitReportQuery } from '@gold/contracts';

interface ProfitMeasure {
  rial: bigint;
  goldEquivalentMg: bigint;
}

interface LockedSale {
  readonly id: string;
  readonly quoteAmountRial: bigint;
  readonly settingsSnapshot: SalesInvoiceSnapshotValue;
  readonly totalsSnapshot: SalesInvoiceSnapshotValue;
  readonly itemType: 'JEWELRY' | 'COIN';
  readonly itemSnapshot: SalesInvoiceSnapshotValue;
  readonly quantity: number;
}

interface ReportRange {
  readonly from: Date | undefined;
  readonly to: Date | undefined;
}

const ZERO_MEASURE: ProfitMeasure = { rial: 0n, goldEquivalentMg: 0n };

function isSnapshotRecord(
  value: SalesInvoiceSnapshotValue | SecondHandPurchaseSnapshotValue,
): value is {
  readonly [key: string]: SalesInvoiceSnapshotValue | SecondHandPurchaseSnapshotValue;
} {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function snapshotInteger(
  snapshot: SalesInvoiceSnapshotValue | SecondHandPurchaseSnapshotValue,
  key: string,
  context: string,
): bigint {
  if (!isSnapshotRecord(snapshot) || typeof snapshot[key] !== 'string' || !/^-?\d+$/u.test(snapshot[key])) {
    throw new ProfitReportSnapshotInvalidError(`${context}.${key} must be an integer string`);
  }
  return BigInt(snapshot[key]);
}

function snapshotString(
  snapshot: SalesInvoiceSnapshotValue | SecondHandPurchaseSnapshotValue,
  key: string,
  context: string,
): string {
  if (!isSnapshotRecord(snapshot) || typeof snapshot[key] !== 'string') {
    throw new ProfitReportSnapshotInvalidError(`${context}.${key} must be a string`);
  }
  return snapshot[key];
}

function snapshotNonNegativeInteger(
  snapshot: SalesInvoiceSnapshotValue | SecondHandPurchaseSnapshotValue,
  key: string,
  context: string,
): bigint {
  const value = snapshotInteger(snapshot, key, context);
  if (value < 0n) {
    throw new ProfitReportSnapshotInvalidError(`${context}.${key} cannot be negative`);
  }
  return value;
}

function mithqalGramsX10k(snapshot: SalesInvoiceSnapshotValue): bigint {
  if (!isSnapshotRecord(snapshot) || typeof snapshot['mithqalGrams'] !== 'string') {
    throw new ProfitReportSnapshotInvalidError('sales settings snapshot.mithqalGrams is missing');
  }
  const match = /^(\d+)\.(\d{4})$/u.exec(snapshot['mithqalGrams']);
  if (match === null || BigInt(match[1]!) <= 0n) {
    throw new ProfitReportSnapshotInvalidError('sales settings snapshot.mithqalGrams is invalid');
  }
  return BigInt(`${match[1]}${match[2]}`);
}

function lockedRate1000(sale: LockedSale): bigint {
  const baseQuoteKarat = snapshotNonNegativeInteger(
    sale.settingsSnapshot,
    'baseQuoteKarat',
    'sales settings snapshot',
  );
  if (baseQuoteKarat <= 0n || baseQuoteKarat > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProfitReportSnapshotInvalidError('sales settings snapshot.baseQuoteKarat is invalid');
  }
  return gramRate1000(
    sale.quoteAmountRial,
    rateDivisorFromMarketSettings(karat(Number(baseQuoteKarat)), mithqalGramsX10k(sale.settingsSnapshot)),
  );
}

function addRialAtLockedRate(target: ProfitMeasure, rialAmount: bigint, rate1000: bigint): void {
  const dual = dualFromRial(rialAmount, rate1000);
  target.rial += dual.rial;
  target.goldEquivalentMg += dual.pureMg;
}

function addPureAtLockedRate(target: ProfitMeasure, pureMg: bigint, rate1000: bigint): void {
  const dual = dualFromPure(pureMg, rate1000);
  target.rial += dual.rial;
  target.goldEquivalentMg += dual.pureMg;
}

function difference(left: ProfitMeasure, right: ProfitMeasure): ProfitMeasure {
  return {
    rial: left.rial - right.rial,
    goldEquivalentMg: left.goldEquivalentMg - right.goldEquivalentMg,
  };
}

function sum(left: ProfitMeasure, right: ProfitMeasure): ProfitMeasure {
  return {
    rial: left.rial + right.rial,
    goldEquivalentMg: left.goldEquivalentMg + right.goldEquivalentMg,
  };
}

function responseMeasure(value: ProfitMeasure): { readonly rial: string; readonly goldEquivalentMg: string } {
  return { rial: value.rial.toString(), goldEquivalentMg: value.goldEquivalentMg.toString() };
}

/**
 * Phase-1 profit projection. It deliberately values only source-document
 * snapshots: a current mazneh is never read. Jewelry remains a pure-gold
 * COGS position; coins are never converted to a stored weight.
 */
@Injectable()
export class ProfitReportService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getProfit(tenantId: string, query: ProfitReportQuery): Promise<ProfitReport> {
    const range: ReportRange = {
      from: query.from === undefined ? undefined : new Date(query.from),
      to: query.to === undefined ? undefined : new Date(query.to),
    };
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const [sales, priceEffect] = await Promise.all([
        this.loadSalesInTransaction(transaction, tenantId, range),
        this.loadBuybackPriceEffectInTransaction(transaction, tenantId, range),
      ]);

      const revenue: ProfitMeasure = { ...ZERO_MEASURE };
      const costOfGoods: ProfitMeasure = { ...ZERO_MEASURE };
      const coinBubbleEffect: ProfitMeasure = { ...ZERO_MEASURE };
      const centralBankVersions = await this.loadCentralBankVersionsInTransaction(
        transaction,
        tenantId,
        sales,
      );
      const seenInvoices = new Set<string>();

      for (const sale of sales) {
        const rate1000 = lockedRate1000(sale);
        if (!seenInvoices.has(sale.id)) {
          addRialAtLockedRate(
            revenue,
            snapshotNonNegativeInteger(sale.totalsSnapshot, 'payableRial', 'sales totals snapshot'),
            rate1000,
          );
          seenInvoices.add(sale.id);
        }

        if (sale.itemType === 'JEWELRY') {
          addPureAtLockedRate(
            costOfGoods,
            snapshotNonNegativeInteger(sale.itemSnapshot, 'pureWeightMg', 'jewelry line snapshot'),
            rate1000,
          );
          continue;
        }

        const intrinsicValueRial = snapshotNonNegativeInteger(
          sale.itemSnapshot,
          'intrinsicValueRial',
          'coin line snapshot',
        );
        addRialAtLockedRate(costOfGoods, BigInt(sale.quantity) * intrinsicValueRial, rate1000);

        const versionId = snapshotString(sale.itemSnapshot, 'coinTypeVersionId', 'coin line snapshot');
        if (centralBankVersions.has(versionId)) {
          addRialAtLockedRate(
            coinBubbleEffect,
            BigInt(sale.quantity) * snapshotInteger(sale.itemSnapshot, 'bubbleRial', 'coin line snapshot'),
            rate1000,
          );
        }
      }

      const grossProfit = difference(revenue, costOfGoods);
      const operatingProfit = difference(grossProfit, coinBubbleEffect);
      const totalProfit = sum(grossProfit, priceEffect);
      return {
        from: query.from ?? null,
        to: query.to ?? null,
        revenue: responseMeasure(revenue),
        costOfGoods: responseMeasure(costOfGoods),
        grossProfit: responseMeasure(grossProfit),
        operatingProfit: responseMeasure(operatingProfit),
        goldPriceEffect: responseMeasure(priceEffect),
        coinBubbleEffect: responseMeasure(coinBubbleEffect),
        totalProfit: responseMeasure(totalProfit),
      };
    });
  }

  private async loadSalesInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    range: ReportRange,
  ): Promise<readonly LockedSale[]> {
    const rows = await transaction
      .select({
        id: salesInvoices.id,
        quoteAmountRial: salesInvoices.quoteAmountRial,
        settingsSnapshot: salesInvoiceVersions.settingsSnapshot,
        totalsSnapshot: salesInvoiceVersions.totalsSnapshot,
        itemType: salesInvoiceItems.itemType,
        itemSnapshot: salesInvoiceItems.lineSnapshot,
        quantity: salesInvoiceItems.quantity,
      })
      .from(salesInvoices)
      .innerJoin(
        salesInvoiceVersions,
        and(
          eq(salesInvoices.tenantId, salesInvoiceVersions.tenantId),
          eq(salesInvoices.id, salesInvoiceVersions.salesInvoiceId),
          eq(salesInvoices.currentVersion, salesInvoiceVersions.version),
        ),
      )
      .innerJoin(
        salesInvoiceItems,
        and(
          eq(salesInvoiceVersions.tenantId, salesInvoiceItems.tenantId),
          eq(salesInvoiceVersions.id, salesInvoiceItems.salesInvoiceVersionId),
        ),
      )
      .where(
        and(
          eq(salesInvoices.tenantId, tenantId),
          eq(salesInvoices.status, 'FINALIZED'),
          isNotNull(salesInvoices.finalizedAt),
          range.from === undefined ? undefined : gte(salesInvoices.finalizedAt, range.from),
          range.to === undefined ? undefined : lt(salesInvoices.finalizedAt, range.to),
        ),
      );

    return rows.map((row) => {
      if (row.quoteAmountRial === null) {
        throw new ProfitReportSnapshotInvalidError(`finalized invoice ${row.id} has no locked quote`);
      }
      return {
        id: row.id,
        quoteAmountRial: row.quoteAmountRial,
        settingsSnapshot: row.settingsSnapshot,
        totalsSnapshot: row.totalsSnapshot,
        itemType: row.itemType,
        itemSnapshot: row.itemSnapshot,
        quantity: row.quantity,
      };
    });
  }

  private async loadCentralBankVersionsInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    sales: readonly LockedSale[],
  ): Promise<ReadonlySet<string>> {
    const ids = [
      ...new Set(
        sales
          .filter((sale) => sale.itemType === 'COIN')
          .map((sale) => snapshotString(sale.itemSnapshot, 'coinTypeVersionId', 'coin line snapshot')),
      ),
    ];
    if (ids.length === 0) return new Set<string>();
    const rows = await transaction
      .select({ id: coinTypeVersions.id })
      .from(coinTypeVersions)
      .where(
        and(
          eq(coinTypeVersions.tenantId, tenantId),
          eq(coinTypeVersions.isCentralBankMinted, true),
          inArray(coinTypeVersions.id, ids),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }

  private async loadBuybackPriceEffectInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    range: ReportRange,
  ): Promise<ProfitMeasure> {
    const purchases = await transaction
      .select({
        sourceInvoiceId: secondHandPurchases.sourceInvoiceId,
        settingsSnapshot: secondHandPurchases.settingsSnapshot,
      })
      .from(secondHandPurchases)
      .where(
        and(
          eq(secondHandPurchases.tenantId, tenantId),
          isNotNull(secondHandPurchases.sourceInvoiceId),
          range.from === undefined ? undefined : gte(secondHandPurchases.effectiveAt, range.from),
          range.to === undefined ? undefined : lt(secondHandPurchases.effectiveAt, range.to),
        ),
      );
    const sourceIds = purchases
      .map((purchase) => purchase.sourceInvoiceId)
      .filter((id): id is string => id !== null);
    if (sourceIds.length === 0) return { ...ZERO_MEASURE };

    const sourceVersions = await transaction
      .select({
        invoiceId: salesInvoices.id,
        totalsSnapshot: salesInvoiceVersions.totalsSnapshot,
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
      .where(and(eq(salesInvoices.tenantId, tenantId), inArray(salesInvoices.id, sourceIds)));
    const sourceByInvoice = new Map(sourceVersions.map((source) => [source.invoiceId, source]));
    const result: ProfitMeasure = { ...ZERO_MEASURE };

    for (const purchase of purchases) {
      if (purchase.sourceInvoiceId === null) continue;
      const source = sourceByInvoice.get(purchase.sourceInvoiceId);
      if (source === undefined) {
        throw new ProfitReportSnapshotInvalidError(
          `B2C buyback source invoice ${purchase.sourceInvoiceId} has no version one`,
        );
      }
      const purchaseRate1000 = snapshotNonNegativeInteger(
        purchase.settingsSnapshot,
        'goldRatePerGramRial',
        'B2C buyback settings snapshot',
      );
      if (purchaseRate1000 === 0n) {
        throw new ProfitReportSnapshotInvalidError('B2C buyback settings snapshot.goldRatePerGramRial is zero');
      }
      const sourcePureWeightMg = snapshotNonNegativeInteger(
        source.totalsSnapshot,
        'pureWeightMg',
        'B2C buyback source totals snapshot',
      );
      const sourceGoldValueRial = snapshotNonNegativeInteger(
        source.totalsSnapshot,
        'goldValueRial',
        'B2C buyback source totals snapshot',
      );
      // A higher purchase-time rate costs the retailer more, so it is a negative profit effect.
      addRialAtLockedRate(
        result,
        -(valueOfPure(pureMg(sourcePureWeightMg), rial(purchaseRate1000)) - sourceGoldValueRial),
        purchaseRate1000,
      );
    }
    return result;
  }
}
