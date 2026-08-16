import { Inject, Injectable } from '@nestjs/common';
import {
  comparableGoldBalanceNumerator,
  dualFromPure,
  dualFromRial,
  toSafeNumber,
} from '@gold/core-calc';
import { and, asc, count, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  assetDimensions,
  coinTypes,
  inventoryMovements,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { ReportingDisplayService } from './reporting-display.service';
import type { Database } from '../../platform/database/connect';
import type { LedgerTransactionSourceType } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { Dashboard, DashboardQuery } from '@gold/contracts';

const ACCOUNT_KEYS = {
  cash: 'CASH',
  salesRevenue: 'SALES_REVENUE',
  purchaseFromConsumer: 'PURCHASE_FROM_CONSUMER',
} as const;

interface RawAmount {
  readonly rial: bigint;
  readonly pureGoldMg: bigint;
}

interface DayBounds {
  readonly start: Date;
  readonly end: Date;
}

function utcDayBounds(asOf: Date): DayBounds {
  const start = new Date(asOf);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function negate(amount: bigint): bigint {
  return -amount;
}

/**
 * Compact, index-backed current-day dashboard. It reads ledger and inventory
 * movements directly; it never writes or caches a financial balance.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ReportingDisplayService) private readonly display: ReportingDisplayService,
  ) {}

  async getDashboard(tenantId: string, query: DashboardQuery): Promise<Dashboard> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const asOf = new Date();
      const day = utcDayBounds(asOf);
      const currentMazneh = await this.display.getLatestMaznehInTransaction(transaction, tenantId);
      const [salesRial, purchasesRial, receiptsRial, paymentsRial, invoiceCount, inventory] =
        await Promise.all([
          this.sumLedgerRialInTransaction(transaction, tenantId, day, {
            accountKey: ACCOUNT_KEYS.salesRevenue,
            sourceTypes: ['SALES_INVOICE'],
          }).then(negate),
          this.sumLedgerRialInTransaction(transaction, tenantId, day, {
            accountKey: ACCOUNT_KEYS.purchaseFromConsumer,
            sourceTypes: ['SECOND_HAND_PURCHASE'],
          }),
          this.sumLedgerRialInTransaction(transaction, tenantId, day, {
            accountKey: ACCOUNT_KEYS.cash,
            sourceTypes: ['SALES_INVOICE', 'SETTLEMENT'],
            sign: 'POSITIVE',
          }),
          this.sumLedgerRialInTransaction(transaction, tenantId, day, {
            accountKey: ACCOUNT_KEYS.cash,
            sourceTypes: ['SECOND_HAND_PURCHASE'],
            sign: 'NEGATIVE',
          }).then(negate),
          this.countTodayInvoicesInTransaction(transaction, tenantId, day),
          this.loadInventoryInTransaction(transaction, tenantId),
        ]);
      const partyBalances =
        currentMazneh === undefined
          ? null
          : await this.loadPartyBalancesInTransaction(
              transaction,
              tenantId,
              currentMazneh.goldRatePerGramRial,
              query.displayUnit,
            );
      const rate = currentMazneh?.goldRatePerGramRial;

      return {
        asOf: asOf.toISOString(),
        dayStartsAt: day.start.toISOString(),
        dayEndsAt: day.end.toISOString(),
        displayUnit: query.displayUnit,
        currentMazneh: currentMazneh?.response ?? null,
        today: {
          sales: this.toFinancialCard({ rial: salesRial, pureGoldMg: 0n }, query.displayUnit, rate),
          purchases: this.toFinancialCard(
            { rial: purchasesRial, pureGoldMg: 0n },
            query.displayUnit,
            rate,
          ),
          receipts: this.toFinancialCard(
            { rial: receiptsRial, pureGoldMg: 0n },
            query.displayUnit,
            rate,
          ),
          payments: this.toFinancialCard(
            { rial: paymentsRial, pureGoldMg: 0n },
            query.displayUnit,
            rate,
          ),
          invoiceCount,
        },
        partyBalances,
        inventory,
      };
    });
  }

  private async sumLedgerRialInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    day: DayBounds,
    input: {
      readonly accountKey: string;
      readonly sourceTypes: readonly LedgerTransactionSourceType[];
      readonly sign?: 'POSITIVE' | 'NEGATIVE' | undefined;
    },
  ): Promise<bigint> {
    const [row] = await transaction
      .select({ total: sql<string>`COALESCE(SUM(${ledgerEntries.quantity}), 0)::text` })
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
      .where(
        and(
          eq(ledgerEntries.tenantId, tenantId),
          eq(ledgerAccounts.systemKey, input.accountKey),
          eq(assetDimensions.kind, 'RIAL'),
          inArray(ledgerTransactions.sourceType, [...input.sourceTypes]),
          gte(ledgerTransactions.effectiveAt, day.start),
          lt(ledgerTransactions.effectiveAt, day.end),
          input.sign === 'POSITIVE' ? sql`${ledgerEntries.quantity} > 0` : undefined,
          input.sign === 'NEGATIVE' ? sql`${ledgerEntries.quantity} < 0` : undefined,
        ),
      );

    return BigInt(row?.total ?? '0');
  }

  private async countTodayInvoicesInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    day: DayBounds,
  ): Promise<number> {
    const [row] = await transaction
      .select({ total: count() })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.tenantId, tenantId),
          eq(ledgerTransactions.sourceType, 'SALES_INVOICE'),
          gte(ledgerTransactions.effectiveAt, day.start),
          lt(ledgerTransactions.effectiveAt, day.end),
        ),
      );
    return row?.total ?? 0;
  }

  private async loadInventoryInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
  ): Promise<Dashboard['inventory']> {
    const [meltedGold, coinRows] = await Promise.all([
      transaction
        .select({ total: sql<string>`COALESCE(SUM(${inventoryMovements.quantity}), 0)::text` })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.itemType, 'MELTED_GOLD'),
          ),
        )
        .then(([row]) => BigInt(row?.total ?? '0')),
      transaction
        .select({
          coinTypeId: coinTypes.id,
          code: coinTypes.code,
          total: sql<string>`SUM(${inventoryMovements.quantity})::text`,
        })
        .from(inventoryMovements)
        .innerJoin(
          coinTypes,
          and(
            eq(inventoryMovements.tenantId, coinTypes.tenantId),
            eq(inventoryMovements.itemId, coinTypes.id),
          ),
        )
        .where(
          and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.itemType, 'COIN')),
        )
        .groupBy(coinTypes.id, coinTypes.code)
        .orderBy(asc(coinTypes.code)),
    ]);

    return {
      meltedGoldPureMg: meltedGold.toString(),
      coins: coinRows.map((coin) => ({
        coinTypeId: coin.coinTypeId,
        code: coin.code,
        count: toSafeNumber(BigInt(coin.total)),
      })),
    };
  }

  private async loadPartyBalancesInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    goldRatePerGramRial: bigint,
    displayUnit: DashboardQuery['displayUnit'],
  ): Promise<NonNullable<Dashboard['partyBalances']>> {
    const rows = await transaction
      .select({
        partyId: ledgerAccounts.partyId,
        dimensionKind: assetDimensions.kind,
        total: sql<string>`SUM(${ledgerEntries.quantity})::text`,
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
        assetDimensions,
        and(
          eq(ledgerEntries.tenantId, assetDimensions.tenantId),
          eq(ledgerEntries.dimensionId, assetDimensions.id),
        ),
      )
      .where(and(eq(ledgerEntries.tenantId, tenantId), isNotNull(ledgerAccounts.partyId)))
      .groupBy(ledgerAccounts.partyId, assetDimensions.kind);

    const balances = new Map<string, { rial: bigint; pureGoldMg: bigint }>();
    for (const row of rows) {
      if (row.partyId === null) continue;
      const balance = balances.get(row.partyId) ?? { rial: 0n, pureGoldMg: 0n };
      if (row.dimensionKind === 'RIAL') balance.rial += BigInt(row.total);
      if (row.dimensionKind === 'GOLD') balance.pureGoldMg += BigInt(row.total);
      balances.set(row.partyId, balance);
    }

    let debtors: RawAmount = { rial: 0n, pureGoldMg: 0n };
    let creditors: RawAmount = { rial: 0n, pureGoldMg: 0n };
    for (const balance of balances.values()) {
      const comparable = comparableGoldBalanceNumerator(
        balance.pureGoldMg,
        balance.rial,
        goldRatePerGramRial,
      );
      if (comparable > 0n) {
        debtors = {
          rial: debtors.rial + balance.rial,
          pureGoldMg: debtors.pureGoldMg + balance.pureGoldMg,
        };
      } else if (comparable < 0n) {
        creditors = {
          rial: creditors.rial + balance.rial,
          pureGoldMg: creditors.pureGoldMg + balance.pureGoldMg,
        };
      }
    }

    return {
      debtors: this.toFinancialCard(debtors, displayUnit, goldRatePerGramRial),
      creditors: this.toFinancialCard(creditors, displayUnit, goldRatePerGramRial),
      coinsRemainSeparate: true,
    };
  }

  private toFinancialCard(
    raw: RawAmount,
    displayUnit: DashboardQuery['displayUnit'],
    goldRatePerGramRial: bigint | undefined,
  ): {
    readonly raw: { readonly rial: string; readonly pureGoldMg: string };
    readonly displayAmount: string | null;
  } {
    const displayAmount =
      goldRatePerGramRial === undefined
        ? null
        : displayUnit === 'GOLD'
          ? raw.pureGoldMg + dualFromRial(raw.rial, goldRatePerGramRial).pureMg
          : raw.rial + dualFromPure(raw.pureGoldMg, goldRatePerGramRial).rial;

    return {
      raw: { rial: raw.rial.toString(), pureGoldMg: raw.pureGoldMg.toString() },
      displayAmount: displayAmount?.toString() ?? null,
    };
  }
}
