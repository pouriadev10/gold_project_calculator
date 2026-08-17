import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  bubble,
  coinPositionValue,
  gramRate1000,
  grossUg,
  intrinsicValue,
  karat,
  rateDivisorFromMarketSettings,
  rial,
  toSafeNumber,
} from '@gold/core-calc';
import { priceQuotes } from '../../platform/database/schema';
import { CoinTypesService } from '../inventory/coin-types.service';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  CoinSettlementInvalidInputError,
  CoinSettlementPricingSettingInvalidError,
  CoinSettlementQuoteNotFoundError,
} from './coin-settlements.errors';
import { SettlementsService } from './settlements.service';
import type { CoinType } from '@gold/core-calc';
import type {
  CoinTypeVersion,
  VersionedSetting,
  VersionedSettingValue,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

const SETTING_KEYS = {
  baseQuoteKarat: 'pricing.base_quote_karat',
  mithqalGrams: 'pricing.mithqal_grams',
} as const;

export interface CreateCoinSettlementInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly coinTypeId: string;
  readonly count: number;
  readonly marketUnitPriceRial: bigint;
  readonly quoteId: string;
  readonly effectiveAt: Date;
  readonly createdBy: string;
}

export interface CreatedCoinSettlement {
  readonly settlementId: string;
  readonly ledgerTransactionId: string;
  readonly inventoryMovementId: string;
  readonly coinTypeId: string;
  readonly count: number;
  readonly settledRial: bigint;
  readonly intrinsicValueRial: bigint;
  readonly bubbleRial: bigint | null;
}

function isSettingRecord(
  value: VersionedSettingValue,
): value is { readonly [key: string]: VersionedSettingValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function settingString(setting: VersionedSetting | undefined, key: string): string {
  if (setting === undefined || !isSettingRecord(setting.valueJson)) {
    throw new CoinSettlementPricingSettingInvalidError(key);
  }

  const value = setting.valueJson['value'];
  if (typeof value !== 'string') {
    throw new CoinSettlementPricingSettingInvalidError(key);
  }

  return value;
}

function positiveIntegerSetting(setting: VersionedSetting | undefined, key: string): bigint {
  const value = settingString(setting, key);
  if (!/^\d+$/u.test(value)) {
    throw new CoinSettlementPricingSettingInvalidError(key);
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new CoinSettlementPricingSettingInvalidError(key);
  }

  return parsed;
}

function mithqalGramsX10k(setting: VersionedSetting | undefined): bigint {
  const value = settingString(setting, SETTING_KEYS.mithqalGrams);
  const match = /^(\d+)\.(\d{4})$/u.exec(value);
  if (match === null || BigInt(match[1]!) <= 0n) {
    throw new CoinSettlementPricingSettingInvalidError(SETTING_KEYS.mithqalGrams);
  }

  return BigInt(`${match[1]}${match[2]}`);
}

/** `bubble()` only receives this discriminated coin type, never bullion. */
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

/**
 * دریافت سکه برای تسویه‌ی طلب ریالی. سکه در inventory و ledger فقط «تعداد»
 * است؛ مشخصات وزنی نسخه‌ی سکه صرفاً برای snapshot ارزش ذاتی و حباب گزارش می‌شود.
 */
@Injectable()
export class CoinSettlementsService {
  constructor(
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(CoinTypesService) private readonly coinTypes: CoinTypesService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService,
    @Inject(LedgerPostingService) private readonly ledger: LedgerPostingService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
  ) {}

  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateCoinSettlementInput,
  ): Promise<CreatedCoinSettlement> {
    if (!Number.isSafeInteger(input.count) || input.count <= 0) {
      throw new CoinSettlementInvalidInputError('Coin settlement count must be a positive integer');
    }
    if (input.marketUnitPriceRial <= 0n) {
      throw new CoinSettlementInvalidInputError(
        'Coin settlement market unit price must be positive',
      );
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
      throw new CoinSettlementQuoteNotFoundError();
    }

    const baseKarat = positiveIntegerSetting(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat);
    if (baseKarat > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CoinSettlementPricingSettingInvalidError(SETTING_KEYS.baseQuoteKarat);
    }

    const goldRate1000Rial = gramRate1000(
      quote.amountRial,
      rateDivisorFromMarketSettings(karat(toSafeNumber(baseKarat)), mithqalGramsX10k(mithqalGrams)),
    );
    const coin = toCoinType(version);
    const marketUnitPriceRial = rial(input.marketUnitPriceRial);
    const intrinsicValueRial = intrinsicValue(coin, goldRate1000Rial);
    const bubbleRial = coin.isCentralBankMinted
      ? bubble(coin, marketUnitPriceRial, goldRate1000Rial)
      : null;
    const settledRial = coinPositionValue(input.count, marketUnitPriceRial);

    const draft = await this.settlements.createDraftInTransaction(transaction, input);
    const [coinInventory, clearing, receivable, coinDimension, rialDimension] = await Promise.all([
      this.accounts.getRequiredSystemAccountInTransaction(
        transaction,
        input.tenantId,
        `INVENTORY_COIN:${input.coinTypeId}`,
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
      this.dimensions.resolveInventoryDimensionInTransaction(
        transaction,
        input.tenantId,
        'COIN',
        input.coinTypeId,
      ),
      this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'RIAL'),
    ]);

    const lockedConversionSnapshot = {
      coinTypeVersionId: version.id,
      marketUnitPriceRial: marketUnitPriceRial.toString(),
      quoteType: quote.quoteType,
      quoteObservedAt: quote.observedAt.toISOString(),
      goldRate1000Rial: goldRate1000Rial.toString(),
      intrinsicValueRial: intrinsicValueRial.toString(),
      bubbleRial: bubbleRial === null ? null : bubbleRial.toString(),
      baseQuoteKarat: settingString(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat),
      mithqalGrams: settingString(mithqalGrams, SETTING_KEYS.mithqalGrams),
    };
    const quantity = BigInt(input.count);
    const finalized = await this.settlements.finalizeInTransaction(transaction, {
      tenantId: input.tenantId,
      settlementId: draft.id,
      effectiveAt: input.effectiveAt,
      createdBy: input.createdBy,
      lines: [
        {
          lineType: 'COIN',
          dimensionId: coinDimension.id,
          quantity,
          sourceAccountId: clearing.id,
          destinationAccountId: coinInventory.id,
          lockedQuoteId: quote.id,
          lockedQuoteAmountRial: quote.amountRial,
          lockedConversionSnapshot,
        },
        {
          lineType: 'RIAL',
          dimensionId: rialDimension.id,
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
      itemType: 'COIN',
      itemId: input.coinTypeId,
      quantity,
      occurredAt: input.effectiveAt,
    });
    const posting = await this.ledger.postInTransaction(transaction, {
      source: { tenantId: input.tenantId, type: 'SETTLEMENT', id: finalized.settlement.id },
      effectiveAt: input.effectiveAt,
      description: `Coin settlement ${finalized.settlement.id}`,
      createdBy: input.createdBy,
      entries: [
        { accountId: coinInventory.id, dimensionId: coinDimension.id, quantity },
        { accountId: clearing.id, dimensionId: coinDimension.id, quantity: -quantity },
        { accountId: receivable.id, dimensionId: rialDimension.id, quantity: -settledRial },
        { accountId: clearing.id, dimensionId: rialDimension.id, quantity: settledRial },
      ],
    });

    return {
      settlementId: finalized.settlement.id,
      ledgerTransactionId: posting.transaction.id,
      inventoryMovementId: movement.id,
      coinTypeId: input.coinTypeId,
      count: input.count,
      settledRial,
      intrinsicValueRial,
      bubbleRial,
    };
  }
}
