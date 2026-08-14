import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  bubble,
  calculateJewelrySale,
  coinPositionValue,
  gramRate1000,
  grossMg,
  grossUg,
  intrinsicValue,
  karat,
  rateDivisorFromMarketSettings,
  rial,
  toSafeNumber,
} from '@gold/core-calc';
import { DRIZZLE } from '../../platform/database/database.module';
import { priceQuotes } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { CoinTypesService } from '../inventory/coin-types.service';
import { JewelryItemsService } from '../inventory/jewelry-items.service';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  SalesPricingInvalidCoinInputError,
  SalesPricingQuoteNotFoundError,
  SalesPricingSettingInvalidError,
} from './sales-pricing.errors';
import type { Database } from '../../platform/database/connect';
import type { CoinTypeVersion, VersionedSetting, VersionedSettingValue } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { CoinType } from '@gold/core-calc';

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

export interface PriceCoinForSaleInput {
  readonly tenantId: string;
  readonly coinTypeId: string;
  readonly count: number;
  readonly marketUnitPriceRial: bigint;
  readonly quoteId: string;
  readonly effectiveAt: Date;
}

/**
 * JSON-safe نتیجه‌ی قیمت‌گذاری سکه — BE-043. `intrinsicValueRial`/`bubbleRial`
 * برای هر یک سکه است (خروجی مستقیم `core-calc`)، نه کل موقعیت. `bubbleRial`
 * فقط برای سکه‌ی بانک مرکزی مقدار دارد؛ در غیر این صورت `null` — قانون حباب.
 */
export interface CoinSalePrice {
  readonly coinTypeVersionId: string;
  readonly coinTypeId: string;
  readonly quoteId: string;
  readonly quoteAmountRial: string;
  readonly quoteObservedAt: string;
  readonly count: number;
  readonly marketUnitPriceRial: string;
  readonly goldRate1000Rial: string;
  readonly intrinsicValueRial: string;
  readonly bubbleRial: string | null;
  readonly payableRial: string;
  readonly settingsSnapshot: Readonly<Record<string, string>>;
}

/** امضای `bubble()` فقط سکه‌ی بانک مرکزی می‌پذیرد؛ این تابع همان تفکیک نوعی را از نسخه‌ی دیتابیسی می‌سازد. */
function toCoinType(version: CoinTypeVersion): CoinType {
  const base = {
    kind: 'coin' as const,
    id: version.coinTypeId,
    label: version.title,
    grossWeightUg: grossUg(version.grossWeightUg),
    karat: karat(version.karat),
  };

  return version.isCentralBankMinted
    ? { ...base, isCentralBankMinted: true }
    : { ...base, isCentralBankMinted: false };
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
    @Inject(CoinTypesService) private readonly coinTypes: CoinTypesService,
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

  async priceCoin(input: PriceCoinForSaleInput): Promise<CoinSalePrice> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.priceCoinInTransaction(transaction, input),
    );
  }

  /**
   * قیمت بازار سکه ورودی کاربر است — فرمول ندارد، چون حباب بازاری است، نه
   * محاسبه‌شدنی (قاعده‌ی ۲-۳). این متد فقط ارزش ذاتی و حباب را برای snapshot
   * گزارشی می‌سازد؛ مبلغ قابل پرداخت همان تعداد × قیمت بازار است.
   */
  async priceCoinInTransaction(
    transaction: TenantTransaction,
    input: PriceCoinForSaleInput,
  ): Promise<CoinSalePrice> {
    if (!Number.isSafeInteger(input.count) || input.count <= 0) {
      throw new SalesPricingInvalidCoinInputError('Coin sale count must be a positive integer');
    }
    if (input.marketUnitPriceRial <= 0n) {
      throw new SalesPricingInvalidCoinInputError('Coin sale market unit price must be positive');
    }

    const [version, quote, baseQuoteKarat, mithqalGrams] = await Promise.all([
      this.coinTypes.requireSelectableForSaleInTransaction(
        transaction,
        input.tenantId,
        input.coinTypeId,
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
    ]);

    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new SalesPricingQuoteNotFoundError();
    }

    const baseKarat = positiveIntegerSetting(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat);
    if (baseKarat > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SalesPricingSettingInvalidError(SETTING_KEYS.baseQuoteKarat);
    }
    const rate1000 = gramRate1000(
      quote.amountRial,
      rateDivisorFromMarketSettings(karat(toSafeNumber(baseKarat)), mithqalGramsX10k(mithqalGrams)),
    );

    const coin = toCoinType(version);
    const marketUnitPriceRial = rial(input.marketUnitPriceRial);
    const intrinsicValueRial = intrinsicValue(coin, rate1000);
    const bubbleRial = coin.isCentralBankMinted ? bubble(coin, marketUnitPriceRial, rate1000) : null;
    const payableRial = coinPositionValue(input.count, marketUnitPriceRial);

    return {
      coinTypeVersionId: version.id,
      coinTypeId: version.coinTypeId,
      quoteId: quote.id,
      quoteAmountRial: quote.amountRial.toString(),
      quoteObservedAt: quote.observedAt.toISOString(),
      count: input.count,
      marketUnitPriceRial: marketUnitPriceRial.toString(),
      goldRate1000Rial: rate1000.toString(),
      intrinsicValueRial: intrinsicValueRial.toString(),
      bubbleRial: bubbleRial === null ? null : bubbleRial.toString(),
      payableRial: payableRial.toString(),
      settingsSnapshot: {
        baseQuoteKarat: settingString(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat),
        mithqalGrams: settingString(mithqalGrams, SETTING_KEYS.mithqalGrams),
      },
    };
  }
}
