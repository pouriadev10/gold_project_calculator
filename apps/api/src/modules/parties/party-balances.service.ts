import { Inject, Injectable } from '@nestjs/common';
import {
  dualFromRial,
  gramRate1000,
  karat,
  rateDivisorFromMarketSettings,
  toSafeNumber,
} from '@gold/core-calc';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import { coinTypes, ledgerAccounts, parties, priceQuotes } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { AccountBalanceService } from '../ledger/account-balance.service';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  PartyBalanceCoinTypeNotFoundError,
  PartyBalanceDisplaySettingInvalidError,
  PartyBalanceReferenceQuoteNotFoundError,
} from './party-balances.errors';
import { PartyNotFoundError } from './parties.service';
import type { AccountBalances } from '../ledger/account-balance.service';
import type { Database } from '../../platform/database/connect';
import type { VersionedSetting, VersionedSettingValue } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { PartyBalances } from '@gold/contracts';

const SETTING_KEYS = {
  baseQuoteKarat: 'pricing.base_quote_karat',
  mithqalGrams: 'pricing.mithqal_grams',
} as const;

type RawBalances = PartyBalances['rawBalances'];
type ConvertedView = PartyBalances['convertedView'];

function isSettingRecord(
  value: VersionedSettingValue | undefined,
): value is { readonly [key: string]: VersionedSettingValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function settingString(setting: VersionedSetting | undefined, key: string): string {
  const settingValue = setting?.valueJson;
  const value = isSettingRecord(settingValue) ? settingValue['value'] : undefined;
  if (typeof value !== 'string') {
    throw new PartyBalanceDisplaySettingInvalidError(key);
  }

  return value;
}

function positiveIntegerSetting(setting: VersionedSetting | undefined, key: string): bigint {
  const value = settingString(setting, key);
  if (!/^\d+$/u.test(value)) {
    throw new PartyBalanceDisplaySettingInvalidError(key);
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new PartyBalanceDisplaySettingInvalidError(key);
  }

  return parsed;
}

function mithqalGramsX10k(setting: VersionedSetting | undefined): bigint {
  const value = settingString(setting, SETTING_KEYS.mithqalGrams);
  const match = /^(\d+)\.(\d{4})$/u.exec(value);
  if (match === null || BigInt(match[1]!) <= 0n) {
    throw new PartyBalanceDisplaySettingInvalidError(SETTING_KEYS.mithqalGrams);
  }

  return BigInt(`${match[1]}${match[2]}`);
}

function addOptionalBalance(balance: AccountBalances, key: 'rial' | 'gold'): bigint {
  return BigInt(balance[key] ?? '0');
}

/**
 * Read-only party subledger projection. Both receivable and payable accounts
 * are combined with their signed ledger quantities, so a payable credit offsets
 * a receivable in the same dimension without ever converting dimensions.
 */
@Injectable()
export class PartyBalancesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AccountBalanceService) private readonly accountBalances: AccountBalanceService,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
  ) {}

  async getBalances(
    tenantId: string,
    partyId: string,
    input: { readonly at: Date; readonly referenceQuoteId?: string | undefined },
  ): Promise<PartyBalances> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const [party] = await transaction
        .select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.tenantId, tenantId), eq(parties.id, partyId)))
        .limit(1);
      if (party === undefined) {
        throw new PartyNotFoundError();
      }

      const accounts = await transaction
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.tenantId, tenantId), eq(ledgerAccounts.partyId, partyId)));
      const balances = await Promise.all(
        accounts.map((account) =>
          this.accountBalances.getAccountBalancesInTransaction(
            transaction,
            tenantId,
            account.id,
            input.at,
          ),
        ),
      );
      const rawBalances = await this.combineRawBalancesInTransaction(
        transaction,
        tenantId,
        balances,
      );
      const convertedView =
        input.referenceQuoteId === undefined
          ? null
          : await this.convertToGoldInTransaction(
              transaction,
              tenantId,
              input.referenceQuoteId,
              rawBalances,
            );

      return {
        partyId: party.id,
        calculatedAt: input.at.toISOString(),
        defaultDisplayUnit: 'GOLD',
        rawBalances,
        convertedView,
      };
    });
  }

  private async combineRawBalancesInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    balances: readonly AccountBalances[],
  ): Promise<RawBalances> {
    let rial = 0n;
    let pureGoldMg = 0n;
    const coinsByCode = new Map<string, bigint>();

    for (const balance of balances) {
      rial += addOptionalBalance(balance, 'rial');
      pureGoldMg += addOptionalBalance(balance, 'gold');
      for (const [code, count] of Object.entries(balance.coins)) {
        coinsByCode.set(code, (coinsByCode.get(code) ?? 0n) + BigInt(count));
      }
    }

    const tenantCoinTypes = await transaction
      .select({ id: coinTypes.id, code: coinTypes.code })
      .from(coinTypes)
      .where(eq(coinTypes.tenantId, tenantId))
      .orderBy(asc(coinTypes.code));
    const coinTypeByCode = new Map(tenantCoinTypes.map((coinType) => [coinType.code, coinType]));

    return {
      rial: rial.toString(),
      pureGoldMg: pureGoldMg.toString(),
      coins: [...coinsByCode.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([code, count]) => {
          const coinType = coinTypeByCode.get(code);
          if (coinType === undefined) {
            throw new PartyBalanceCoinTypeNotFoundError(code);
          }
          return { coinTypeId: coinType.id, code, count: toSafeNumber(count) };
        }),
    };
  }

  private async convertToGoldInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    referenceQuoteId: string,
    rawBalances: RawBalances,
  ): Promise<Exclude<ConvertedView, null>> {
    const [quote] = await transaction
      .select()
      .from(priceQuotes)
      .where(and(eq(priceQuotes.tenantId, tenantId), eq(priceQuotes.id, referenceQuoteId)))
      .limit(1);
    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new PartyBalanceReferenceQuoteNotFoundError();
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
      throw new PartyBalanceDisplaySettingInvalidError(SETTING_KEYS.baseQuoteKarat);
    }
    const goldRatePerGramRial = gramRate1000(
      quote.amountRial,
      rateDivisorFromMarketSettings(karat(Number(baseKarat)), mithqalGramsX10k(mithqalGrams)),
    );
    const rialEquivalent = dualFromRial(BigInt(rawBalances.rial), goldRatePerGramRial);

    return {
      displayUnit: 'GOLD',
      referenceMazneh: {
        id: quote.id,
        amountRial: quote.amountRial.toString(),
        observedAt: quote.observedAt.toISOString(),
        goldRatePerGramRial: goldRatePerGramRial.toString(),
      },
      rialEquivalentPureGoldMg: rialEquivalent.pureMg.toString(),
      totalGoldDisplayPureMg: (BigInt(rawBalances.pureGoldMg) + rialEquivalent.pureMg).toString(),
      coinsRemainSeparate: true,
    };
  }
}
