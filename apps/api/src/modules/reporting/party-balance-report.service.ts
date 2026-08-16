import { Inject, Injectable } from '@nestjs/common';
import {
  comparableGoldBalanceNumerator,
  dualFromPure,
  dualFromRial,
  gramRate1000,
  karat,
  rateDivisorFromMarketSettings,
  toSafeNumber,
} from '@gold/core-calc';
import { and, asc, eq, ilike } from 'drizzle-orm';
import { normalizeTextForSearch } from '../../shared/validation';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  assetDimensions,
  coinTypes,
  ledgerAccounts,
  ledgerEntries,
  parties,
  priceQuotes,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  ReportingDisplaySettingInvalidError,
  ReportingReferenceQuoteNotFoundError,
} from './reporting.errors';
import type { Database } from '../../platform/database/connect';
import type { VersionedSetting, VersionedSettingValue } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type {
  PartyBalanceReport,
  PartyBalanceReportQuery,
  PartyReportDirection,
} from '@gold/contracts';

const SETTING_KEYS = {
  baseQuoteKarat: 'pricing.base_quote_karat',
  mithqalGrams: 'pricing.mithqal_grams',
} as const;

type ReportItem = PartyBalanceReport['items'][number];
type RawBalances = ReportItem['rawBalances'];
type CoinBalance = RawBalances['coins'][number];

interface PartyBalanceAccumulator {
  readonly party: ReportItem['party'];
  readonly normalizedName: string;
  rial: bigint;
  pureGoldMg: bigint;
  readonly coinsById: Map<string, { readonly id: string; readonly code: string; count: bigint }>;
}

interface ReferenceMazneh {
  readonly response: PartyBalanceReport['referenceMazneh'];
  readonly goldRatePerGramRial: bigint;
}

interface SortableReportItem {
  readonly item: ReportItem;
  readonly normalizedName: string;
  readonly comparableBalance: bigint;
  readonly hasDebtorCoin: boolean;
  readonly hasCreditorCoin: boolean;
}

function isSettingRecord(
  value: VersionedSettingValue | undefined,
): value is { readonly [key: string]: VersionedSettingValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function settingString(setting: VersionedSetting | undefined, key: string): string {
  const value = isSettingRecord(setting?.valueJson) ? setting.valueJson['value'] : undefined;
  if (typeof value !== 'string') {
    throw new ReportingDisplaySettingInvalidError(key);
  }
  return value;
}

function positiveIntegerSetting(setting: VersionedSetting | undefined, key: string): bigint {
  const value = settingString(setting, key);
  if (!/^\d+$/u.test(value)) {
    throw new ReportingDisplaySettingInvalidError(key);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new ReportingDisplaySettingInvalidError(key);
  }
  return parsed;
}

function mithqalGramsX10k(setting: VersionedSetting | undefined): bigint {
  const value = settingString(setting, SETTING_KEYS.mithqalGrams);
  const match = /^(\d+)\.(\d{4})$/u.exec(value);
  if (match === null || BigInt(match[1]!) <= 0n) {
    throw new ReportingDisplaySettingInvalidError(SETTING_KEYS.mithqalGrams);
  }
  return BigInt(`${match[1]}${match[2]}`);
}

function directionFor(comparableBalance: bigint): ReportItem['convertibleDirection'] {
  if (comparableBalance > 0n) return 'DEBTOR';
  if (comparableBalance < 0n) return 'CREDITOR';
  return 'SETTLED';
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Read-only debtor/creditor projection. Rial and gold are comparable only at
 * the requested reference mazneh; coins deliberately remain countable detail.
 */
@Injectable()
export class PartyBalanceReportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
  ) {}

  async getReport(
    tenantId: string,
    direction: PartyReportDirection,
    query: PartyBalanceReportQuery,
  ): Promise<PartyBalanceReport> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const referenceMazneh = await this.loadReferenceMaznehInTransaction(
        transaction,
        tenantId,
        query.referenceQuoteId,
      );
      const partyBalances = await this.loadPartyBalancesInTransaction(
        transaction,
        tenantId,
        query.search,
      );
      const reportItems = partyBalances
        .map((balance) =>
          this.toSortableReportItem(
            balance,
            query.displayUnit,
            referenceMazneh.goldRatePerGramRial,
          ),
        )
        .filter((reportItem) => this.belongsToDirection(reportItem, direction))
        .sort((left, right) => this.compareReportItems(left, right, query.sortDirection));
      const page = reportItems
        .slice(query.offset, query.offset + query.limit)
        .map(({ item }) => item);

      return {
        direction,
        displayUnit: query.displayUnit,
        referenceMazneh: referenceMazneh.response,
        items: page,
        total: reportItems.length,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  private async loadReferenceMaznehInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    referenceQuoteId: string,
  ): Promise<ReferenceMazneh> {
    const [quote] = await transaction
      .select()
      .from(priceQuotes)
      .where(and(eq(priceQuotes.tenantId, tenantId), eq(priceQuotes.id, referenceQuoteId)))
      .limit(1);
    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new ReportingReferenceQuoteNotFoundError();
    }

    const [baseQuoteKarat, mithqalGrams] = await Promise.all([
      this.settings.getEffectiveInTransaction(
        transaction,
        tenantId,
        SETTING_KEYS.baseQuoteKarat,
        quote.observedAt,
      ),
      this.settings.getEffectiveInTransaction(
        transaction,
        tenantId,
        SETTING_KEYS.mithqalGrams,
        quote.observedAt,
      ),
    ]);
    const baseKarat = positiveIntegerSetting(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat);
    if (baseKarat > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ReportingDisplaySettingInvalidError(SETTING_KEYS.baseQuoteKarat);
    }
    const goldRatePerGramRial = gramRate1000(
      quote.amountRial,
      rateDivisorFromMarketSettings(karat(Number(baseKarat)), mithqalGramsX10k(mithqalGrams)),
    );

    return {
      response: {
        id: quote.id,
        amountRial: quote.amountRial.toString(),
        observedAt: quote.observedAt.toISOString(),
        goldRatePerGramRial: goldRatePerGramRial.toString(),
      },
      goldRatePerGramRial,
    };
  }

  private async loadPartyBalancesInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    search: string | undefined,
  ): Promise<readonly PartyBalanceAccumulator[]> {
    const rows = await transaction
      .select({
        partyId: parties.id,
        partyDisplayName: parties.displayName,
        partyNormalizedName: parties.normalizedName,
        partyType: parties.type,
        partyStatus: parties.status,
        partyMobile: parties.mobile,
        quantity: ledgerEntries.quantity,
        dimensionKind: assetDimensions.kind,
        coinTypeId: coinTypes.id,
        coinCode: coinTypes.code,
      })
      .from(parties)
      .innerJoin(
        ledgerAccounts,
        and(eq(parties.tenantId, ledgerAccounts.tenantId), eq(parties.id, ledgerAccounts.partyId)),
      )
      .innerJoin(
        ledgerEntries,
        and(
          eq(ledgerAccounts.tenantId, ledgerEntries.tenantId),
          eq(ledgerAccounts.id, ledgerEntries.accountId),
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
          eq(parties.tenantId, tenantId),
          search === undefined
            ? undefined
            : ilike(parties.normalizedName, `%${normalizeTextForSearch(search)}%`),
        ),
      )
      .orderBy(asc(parties.normalizedName), asc(parties.id));

    const balancesByPartyId = new Map<string, PartyBalanceAccumulator>();
    for (const row of rows) {
      const balance = balancesByPartyId.get(row.partyId) ?? {
        party: {
          id: row.partyId,
          displayName: row.partyDisplayName,
          type: row.partyType,
          status: row.partyStatus,
          mobile: row.partyMobile,
        },
        normalizedName: row.partyNormalizedName,
        rial: 0n,
        pureGoldMg: 0n,
        coinsById: new Map(),
      };
      balancesByPartyId.set(row.partyId, balance);

      switch (row.dimensionKind) {
        case 'RIAL':
          balance.rial += row.quantity;
          break;
        case 'GOLD':
          balance.pureGoldMg += row.quantity;
          break;
        case 'COIN': {
          if (row.coinTypeId === null || row.coinCode === null) {
            throw new Error('Coin dimension is missing its coin type');
          }
          const coin = balance.coinsById.get(row.coinTypeId) ?? {
            id: row.coinTypeId,
            code: row.coinCode,
            count: 0n,
          };
          coin.count += row.quantity;
          balance.coinsById.set(row.coinTypeId, coin);
          break;
        }
        default:
          break;
      }
    }

    return [...balancesByPartyId.values()];
  }

  private toSortableReportItem(
    balance: PartyBalanceAccumulator,
    displayUnit: PartyBalanceReportQuery['displayUnit'],
    goldRatePerGramRial: bigint,
  ): SortableReportItem {
    const coins: CoinBalance[] = [...balance.coinsById.values()]
      .filter((coin) => coin.count !== 0n)
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((coin) => ({ coinTypeId: coin.id, code: coin.code, count: toSafeNumber(coin.count) }));
    const comparableBalance = comparableGoldBalanceNumerator(
      balance.pureGoldMg,
      balance.rial,
      goldRatePerGramRial,
    );
    const displayBalance =
      displayUnit === 'GOLD'
        ? balance.pureGoldMg + dualFromRial(balance.rial, goldRatePerGramRial).pureMg
        : balance.rial + dualFromPure(balance.pureGoldMg, goldRatePerGramRial).rial;

    return {
      item: {
        party: balance.party,
        rawBalances: {
          rial: balance.rial.toString(),
          pureGoldMg: balance.pureGoldMg.toString(),
          coins,
        },
        displayBalance: displayBalance.toString(),
        convertibleDirection: directionFor(comparableBalance),
        coinsRemainSeparate: true,
      },
      normalizedName: balance.normalizedName,
      comparableBalance,
      hasDebtorCoin: coins.some((coin) => coin.count > 0),
      hasCreditorCoin: coins.some((coin) => coin.count < 0),
    };
  }

  private belongsToDirection(
    reportItem: SortableReportItem,
    direction: PartyReportDirection,
  ): boolean {
    return direction === 'DEBTOR'
      ? reportItem.comparableBalance > 0n || reportItem.hasDebtorCoin
      : reportItem.comparableBalance < 0n || reportItem.hasCreditorCoin;
  }

  private compareReportItems(
    left: SortableReportItem,
    right: SortableReportItem,
    sortDirection: PartyBalanceReportQuery['sortDirection'],
  ): number {
    const byMagnitude = compareBigInt(
      absolute(left.comparableBalance),
      absolute(right.comparableBalance),
    );
    if (byMagnitude !== 0) return sortDirection === 'DESC' ? -byMagnitude : byMagnitude;
    const byName = left.normalizedName.localeCompare(right.normalizedName);
    if (byName !== 0) return byName;
    return left.item.party.id.localeCompare(right.item.party.id);
  }
}
