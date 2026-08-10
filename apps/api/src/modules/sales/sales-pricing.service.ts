import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  calculateJewelrySale,
  grossMg,
  karat,
  rateDivisorFromMarketSettings,
} from '@gold/core-calc';
import { DRIZZLE } from '../../platform/database/database.module';
import { priceQuotes } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { JewelryItemsService } from '../inventory/jewelry-items.service';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import { SalesPricingQuoteNotFoundError, SalesPricingSettingInvalidError } from './sales-pricing.errors';
import type { Database } from '../../platform/database/connect';
import type { VersionedSetting, VersionedSettingValue } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

const SETTING_KEYS = {
  baseQuoteKarat: 'pricing.base_quote_karat',
  mithqalGrams: 'pricing.mithqal_grams',
  roundingUnitRial: 'pricing.rial_rounding_unit',
  roundingPolicy: 'pricing.rounding_policy',
  profitRateBps: 'sales.jewelry_profit_rate_bps',
  taxRateBps: 'tax.gold_jewelry_labor_profit_commission_rate_bps',
} as const;

export interface PriceJewelryForSaleInput {
  readonly tenantId: string;
  readonly jewelryItemId: string;
  readonly quoteId: string;
  readonly effectiveAt: Date;
}

/** JSON-safe calculation result ready to be snapshotted on the invoice in BE-041. */
export interface JewelrySalePrice {
  readonly jewelryItemVersionId: string;
  readonly quoteId: string;
  readonly quoteAmountRial: string;
  readonly quoteObservedAt: string;
  readonly pureWeightMg: string;
  readonly goldRatePerGramRial: string;
  readonly goldValueRial: string;
  readonly wageRial: string;
  readonly profitRial: string;
  readonly taxRial: string;
  readonly payableBeforeRoundingRial: string;
  readonly payableRial: string;
  readonly settingsSnapshot: Readonly<Record<string, string>>;
}

function isSettingRecord(
  value: VersionedSettingValue,
): value is { readonly [key: string]: VersionedSettingValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function settingString(setting: VersionedSetting | undefined, key: string): string {
  if (setting === undefined) {
    throw new SalesPricingSettingInvalidError(key);
  }
  const value = setting.valueJson;
  if (
    !isSettingRecord(value) ||
    typeof value['value'] !== 'string'
  ) {
    throw new SalesPricingSettingInvalidError(key);
  }
  return value['value'];
}

function positiveIntegerSetting(setting: VersionedSetting | undefined, key: string): bigint {
  const value = settingString(setting, key);
  if (!/^\d+$/u.test(value)) {
    throw new SalesPricingSettingInvalidError(key);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new SalesPricingSettingInvalidError(key);
  }
  return parsed;
}

function nonNegativeIntegerSetting(setting: VersionedSetting | undefined, key: string): bigint {
  const value = settingString(setting, key);
  if (!/^\d+$/u.test(value)) {
    throw new SalesPricingSettingInvalidError(key);
  }
  return BigInt(value);
}

/** Market convention is stored as a decimal string; this parser never uses a float. */
function mithqalGramsX10k(setting: VersionedSetting | undefined): bigint {
  const value = settingString(setting, SETTING_KEYS.mithqalGrams);
  const match = /^(\d+)\.(\d{4})$/u.exec(value);
  if (match === null) {
    throw new SalesPricingSettingInvalidError(SETTING_KEYS.mithqalGrams);
  }
  return BigInt(`${match[1]}${match[2]}`);
}

@Injectable()
export class SalesPricingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(JewelryItemsService) private readonly jewelryItems: JewelryItemsService,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
  ) {}

  async priceJewelry(input: PriceJewelryForSaleInput): Promise<JewelrySalePrice> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.priceJewelryInTransaction(transaction, input),
    );
  }

  /**
   * All price-bearing fields come from tenant-scoped records. The caller may
   * select an item and a quote, but cannot supply a total, weight, wage, tax,
   * profit, or rounding policy to manipulate the payable amount.
   */
  async priceJewelryInTransaction(
    transaction: TenantTransaction,
    input: PriceJewelryForSaleInput,
  ): Promise<JewelrySalePrice> {
    const [version, quote, baseQuoteKarat, mithqalGrams, roundingUnit, roundingPolicy, profitRate, taxRate] =
      await Promise.all([
        this.jewelryItems.requireSelectableForSaleInTransaction(
          transaction,
          input.tenantId,
          input.jewelryItemId,
          input.effectiveAt,
        ),
        transaction
          .select()
          .from(priceQuotes)
          .where(and(eq(priceQuotes.tenantId, input.tenantId), eq(priceQuotes.id, input.quoteId)))
          .limit(1)
          .then(([found]) => found),
        this.settings.getEffectiveInTransaction(
          transaction,
          input.tenantId,
          SETTING_KEYS.baseQuoteKarat,
          input.effectiveAt,
        ),
        this.settings.getEffectiveInTransaction(
          transaction,
          input.tenantId,
          SETTING_KEYS.mithqalGrams,
          input.effectiveAt,
        ),
        this.settings.getEffectiveInTransaction(
          transaction,
          input.tenantId,
          SETTING_KEYS.roundingUnitRial,
          input.effectiveAt,
        ),
        this.settings.getEffectiveInTransaction(
          transaction,
          input.tenantId,
          SETTING_KEYS.roundingPolicy,
          input.effectiveAt,
        ),
        this.settings.getEffectiveInTransaction(
          transaction,
          input.tenantId,
          SETTING_KEYS.profitRateBps,
          input.effectiveAt,
        ),
        this.settings.getEffectiveInTransaction(
          transaction,
          input.tenantId,
          SETTING_KEYS.taxRateBps,
          input.effectiveAt,
        ),
      ]);

    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new SalesPricingQuoteNotFoundError();
    }
    if (settingString(roundingPolicy, SETTING_KEYS.roundingPolicy) !== 'HALF_UP') {
      throw new SalesPricingSettingInvalidError(SETTING_KEYS.roundingPolicy);
    }

    const baseKarat = positiveIntegerSetting(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat);
    if (baseKarat > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SalesPricingSettingInvalidError(SETTING_KEYS.baseQuoteKarat);
    }
    const roundingUnitRial = positiveIntegerSetting(roundingUnit, SETTING_KEYS.roundingUnitRial);
    const calculation = calculateJewelrySale({
      grossWeightMg: version.grossWeightMg,
      karat: karat(version.karat),
      deductions: {
        stone: grossMg(version.stoneWeightMg),
        other: grossMg(version.otherDeductionWeightMg),
      },
      wageType: version.wageType,
      wageValue: version.wageValue,
      maznehRial: quote.amountRial,
      profitRateBps: nonNegativeIntegerSetting(profitRate, SETTING_KEYS.profitRateBps),
      taxRateBps: nonNegativeIntegerSetting(taxRate, SETTING_KEYS.taxRateBps),
      roundingUnitRial,
      rateDivisor: rateDivisorFromMarketSettings(
        karat(Number(baseKarat)),
        mithqalGramsX10k(mithqalGrams),
      ),
    });

    return {
      jewelryItemVersionId: version.id,
      quoteId: quote.id,
      quoteAmountRial: quote.amountRial.toString(),
      quoteObservedAt: quote.observedAt.toISOString(),
      pureWeightMg: calculation.pureWeightMg.toString(),
      goldRatePerGramRial: calculation.goldRatePerGramRial.toString(),
      goldValueRial: calculation.goldValueRial.toString(),
      wageRial: calculation.wageRial.toString(),
      profitRial: calculation.profitRial.toString(),
      taxRial: calculation.taxRial.toString(),
      payableBeforeRoundingRial: calculation.payableBeforeRoundingRial.toString(),
      payableRial: calculation.payableRial.toString(),
      settingsSnapshot: {
        baseQuoteKarat: settingString(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat),
        mithqalGrams: settingString(mithqalGrams, SETTING_KEYS.mithqalGrams),
        roundingUnitRial: settingString(roundingUnit, SETTING_KEYS.roundingUnitRial),
        roundingPolicy: settingString(roundingPolicy, SETTING_KEYS.roundingPolicy),
        profitRateBps: settingString(profitRate, SETTING_KEYS.profitRateBps),
        taxRateBps: settingString(taxRate, SETTING_KEYS.taxRateBps),
      },
    };
  }
}
