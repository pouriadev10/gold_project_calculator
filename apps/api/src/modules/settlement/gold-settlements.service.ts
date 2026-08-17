import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  gramRate1000,
  grossMg,
  karat,
  rateDivisorFromMarketSettings,
  toPureMg,
  toSafeNumber,
  valueOfPure,
} from '@gold/core-calc';
import { priceQuotes } from '../../platform/database/schema';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  GoldSettlementPricingSettingInvalidError,
  GoldSettlementPureWeightZeroError,
  GoldSettlementQuoteNotFoundError,
} from './gold-settlements.errors';
import { SettlementsService } from './settlements.service';
import type { VersionedSetting, VersionedSettingValue } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

const SETTING_KEYS = {
  baseQuoteKarat: 'pricing.base_quote_karat',
  mithqalGrams: 'pricing.mithqal_grams',
} as const;

export interface CreateGoldSettlementInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly grossWeightMg: bigint;
  readonly karat: number;
  readonly quoteId: string;
  readonly effectiveAt: Date;
  readonly createdBy: string;
}

export interface CreatedGoldSettlement {
  readonly settlementId: string;
  readonly ledgerTransactionId: string;
  readonly inventoryMovementId: string;
  readonly pureWeightMg: bigint;
  readonly settledRial: bigint;
  readonly goldRatePerGramRial: bigint;
}

function isSettingRecord(
  value: VersionedSettingValue,
): value is { readonly [key: string]: VersionedSettingValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function settingString(setting: VersionedSetting | undefined, key: string): string {
  if (setting === undefined || !isSettingRecord(setting.valueJson)) {
    throw new GoldSettlementPricingSettingInvalidError(key);
  }

  const value = setting.valueJson['value'];
  if (typeof value !== 'string') {
    throw new GoldSettlementPricingSettingInvalidError(key);
  }

  return value;
}

function positiveIntegerSetting(setting: VersionedSetting | undefined, key: string): bigint {
  const value = settingString(setting, key);
  if (!/^\d+$/u.test(value)) {
    throw new GoldSettlementPricingSettingInvalidError(key);
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new GoldSettlementPricingSettingInvalidError(key);
  }

  return parsed;
}

function mithqalGramsX10k(setting: VersionedSetting | undefined): bigint {
  const value = settingString(setting, SETTING_KEYS.mithqalGrams);
  const match = /^(\d+)\.(\d{4})$/u.exec(value);
  if (match === null || BigInt(match[1]!) <= 0n) {
    throw new GoldSettlementPricingSettingInvalidError(SETTING_KEYS.mithqalGrams);
  }

  return BigInt(`${match[1]}${match[2]}`);
}

/**
 * دریافت طلا برای تسویه‌ی طلب ریالی. نرخ به‌همراه quote و قرارداد بازارِ
 * مؤثر در همان لحظه قفل می‌شود؛ محاسبه فقط با bigint و core-calc انجام می‌شود.
 */
@Injectable()
export class GoldSettlementsService {
  constructor(
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService,
    @Inject(LedgerPostingService) private readonly ledger: LedgerPostingService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
  ) {}

  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateGoldSettlementInput,
  ): Promise<CreatedGoldSettlement> {
    const [quote, baseQuoteKarat, mithqalGrams] = await Promise.all([
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
      throw new GoldSettlementQuoteNotFoundError();
    }

    const normalizedKarat = karat(input.karat);
    const pureWeightMg = toPureMg(grossMg(input.grossWeightMg), normalizedKarat);
    if (pureWeightMg <= 0n) {
      throw new GoldSettlementPureWeightZeroError();
    }

    const baseKarat = positiveIntegerSetting(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat);
    const rateDivisor = rateDivisorFromMarketSettings(
      karat(toSafeNumber(baseKarat)),
      mithqalGramsX10k(mithqalGrams),
    );
    const goldRatePerGramRial = gramRate1000(quote.amountRial, rateDivisor);
    const settledRial = valueOfPure(pureWeightMg, goldRatePerGramRial);

    const draft = await this.settlements.createDraftInTransaction(transaction, input);
    const [inventoryMeltedGold, clearing, receivable, gold, rial] = await Promise.all([
      this.accounts.getRequiredSystemAccountInTransaction(
        transaction,
        input.tenantId,
        'INVENTORY_MELTED_GOLD',
      ),
      this.accounts.getRequiredSystemAccountInTransaction(
        transaction,
        input.tenantId,
        'SETTLEMENT_CONVERSION_CLEARING',
      ),
      this.accounts
        .ensurePartyAccountsInTransaction(transaction, {
          tenantId: input.tenantId,
          partyId: input.partyId,
        })
        .then((party) => party.receivable),
      this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'GOLD'),
      this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'RIAL'),
    ]);

    const lockedConversionSnapshot = {
      quoteType: quote.quoteType,
      quoteObservedAt: quote.observedAt.toISOString(),
      baseQuoteKarat: settingString(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat),
      mithqalGrams: settingString(mithqalGrams, SETTING_KEYS.mithqalGrams),
      rateDivisor: rateDivisor.toString(),
      goldRatePerGramRial: goldRatePerGramRial.toString(),
    };
    const finalized = await this.settlements.finalizeInTransaction(transaction, {
      tenantId: input.tenantId,
      settlementId: draft.id,
      effectiveAt: input.effectiveAt,
      createdBy: input.createdBy,
      lines: [
        {
          lineType: 'GOLD',
          dimensionId: gold.id,
          quantity: pureWeightMg,
          sourceAccountId: clearing.id,
          destinationAccountId: inventoryMeltedGold.id,
          lockedQuoteId: quote.id,
          lockedQuoteAmountRial: quote.amountRial,
          lockedConversionSnapshot,
        },
        {
          lineType: 'RIAL',
          dimensionId: rial.id,
          quantity: settledRial,
          sourceAccountId: receivable.id,
          destinationAccountId: clearing.id,
          lockedQuoteId: quote.id,
          lockedQuoteAmountRial: quote.amountRial,
          lockedConversionSnapshot,
        },
      ],
    });

    const movement = await this.movements.recordInTransaction(transaction, input.tenantId, {
      sourceType: 'SETTLEMENT',
      sourceId: finalized.settlement.id,
      itemType: 'MELTED_GOLD',
      quantity: pureWeightMg,
      occurredAt: input.effectiveAt,
    });
    const posting = await this.ledger.postInTransaction(transaction, {
      source: { tenantId: input.tenantId, type: 'SETTLEMENT', id: finalized.settlement.id },
      effectiveAt: input.effectiveAt,
      description: `Gold settlement ${finalized.settlement.id}`,
      createdBy: input.createdBy,
      entries: [
        { accountId: inventoryMeltedGold.id, dimensionId: gold.id, quantity: pureWeightMg },
        { accountId: clearing.id, dimensionId: gold.id, quantity: -pureWeightMg },
        { accountId: receivable.id, dimensionId: rial.id, quantity: -settledRial },
        { accountId: clearing.id, dimensionId: rial.id, quantity: settledRial },
      ],
    });

    return {
      settlementId: finalized.settlement.id,
      ledgerTransactionId: posting.transaction.id,
      inventoryMovementId: movement.id,
      pureWeightMg,
      settledRial,
      goldRatePerGramRial,
    };
  }
}
