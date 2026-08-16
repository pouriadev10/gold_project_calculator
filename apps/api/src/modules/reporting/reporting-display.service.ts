import { Inject, Injectable } from '@nestjs/common';
import { gramRate1000, karat, rateDivisorFromMarketSettings } from '@gold/core-calc';
import { and, desc, eq } from 'drizzle-orm';
import { priceQuotes } from '../../platform/database/schema';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  ReportingDisplaySettingInvalidError,
  ReportingReferenceQuoteNotFoundError,
} from './reporting.errors';
import type { VersionedSetting, VersionedSettingValue } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { PartyBalanceReport } from '@gold/contracts';

const SETTING_KEYS = {
  baseQuoteKarat: 'pricing.base_quote_karat',
  mithqalGrams: 'pricing.mithqal_grams',
} as const;

export interface ReportingMazneh {
  readonly response: PartyBalanceReport['referenceMazneh'];
  readonly goldRatePerGramRial: bigint;
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

/** Reference-mazneh display policy shared by reporting read models. */
@Injectable()
export class ReportingDisplayService {
  constructor(
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
  ) {}

  async getReferenceMaznehInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    referenceQuoteId: string,
  ): Promise<ReportingMazneh> {
    const [quote] = await transaction
      .select()
      .from(priceQuotes)
      .where(and(eq(priceQuotes.tenantId, tenantId), eq(priceQuotes.id, referenceQuoteId)))
      .limit(1);
    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new ReportingReferenceQuoteNotFoundError();
    }
    return this.toReportingMaznehInTransaction(transaction, tenantId, quote);
  }

  async getLatestMaznehInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
  ): Promise<ReportingMazneh | undefined> {
    const [quote] = await transaction
      .select()
      .from(priceQuotes)
      .where(and(eq(priceQuotes.tenantId, tenantId), eq(priceQuotes.quoteType, 'MAZNEH')))
      .orderBy(desc(priceQuotes.observedAt), desc(priceQuotes.createdAt), desc(priceQuotes.id))
      .limit(1);
    if (quote === undefined || quote.amountRial <= 0n) return undefined;
    return this.toReportingMaznehInTransaction(transaction, tenantId, quote);
  }

  private async toReportingMaznehInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    quote: {
      readonly id: string;
      readonly amountRial: bigint;
      readonly observedAt: Date;
    },
  ): Promise<ReportingMazneh> {
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
}
