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
import { AuditService } from '../../platform/audit/audit.service';
import {
  priceQuotes,
  secondHandPurchaseItems,
  secondHandPurchases,
} from '../../platform/database/schema';
import { CoinTypesService } from '../inventory/coin-types.service';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { PartiesService } from '../parties/parties.service';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  SecondHandCoinPurchaseInvalidInputError,
  SecondHandPurchasePaidRialExceedsAmountError,
  SecondHandPurchasePartyNotConsumerError,
  SecondHandPurchasePartyNotFoundError,
  SecondHandPurchasePricingSettingInvalidError,
  SecondHandPurchaseQuoteNotFoundError,
} from './second-hand-gold-purchases.errors';
import type { CoinType } from '@gold/core-calc';
import type { LedgerPostingEntryInput } from '../ledger/ledger-posting.service';
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

export interface CreateSecondHandCoinPurchaseInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly coinTypeId: string;
  readonly count: number;
  readonly purchaseUnitPriceRial: bigint;
  readonly quoteId: string;
  readonly paidRial: bigint;
  readonly effectiveAt: Date;
  readonly createdBy: string;
}

export interface CreatedSecondHandCoinPurchase {
  readonly secondHandPurchaseId: string;
  readonly ledgerTransactionId: string;
  readonly inventoryMovementId: string;
  readonly coinTypeId: string;
  readonly count: number;
  readonly purchaseUnitPriceRial: bigint;
  readonly purchaseAmountRial: bigint;
  readonly paidRial: bigint;
  readonly payableRial: bigint;
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
    throw new SecondHandPurchasePricingSettingInvalidError(key);
  }

  const value = setting.valueJson['value'];
  if (typeof value !== 'string') {
    throw new SecondHandPurchasePricingSettingInvalidError(key);
  }

  return value;
}

function positiveIntegerSetting(setting: VersionedSetting | undefined, key: string): bigint {
  const value = settingString(setting, key);
  if (!/^\d+$/u.test(value)) {
    throw new SecondHandPurchasePricingSettingInvalidError(key);
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new SecondHandPurchasePricingSettingInvalidError(key);
  }

  return parsed;
}

function mithqalGramsX10k(setting: VersionedSetting | undefined): bigint {
  const value = settingString(setting, SETTING_KEYS.mithqalGrams);
  const match = /^(\d+)\.(\d{4})$/u.exec(value);
  if (match === null || BigInt(match[1]!) <= 0n) {
    throw new SecondHandPurchasePricingSettingInvalidError(SETTING_KEYS.mithqalGrams);
  }

  return BigInt(`${match[1]}${match[2]}`);
}

/** `bubble()` only receives this discriminated coin type, never a bullion type. */
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
 * Registers a new purchase of a countable coin position from a consumer.
 * Coin unit prices are entered for this purchase only and deliberately have
 * no relationship to a prior or current sale price.
 */
@Injectable()
export class SecondHandCoinPurchasesService {
  constructor(
    @Inject(PartiesService) private readonly parties: PartiesService,
    @Inject(CoinTypesService) private readonly coinTypes: CoinTypesService,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
    @Inject(LedgerPostingService) private readonly ledger: LedgerPostingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateSecondHandCoinPurchaseInput,
  ): Promise<CreatedSecondHandCoinPurchase> {
    if (!Number.isSafeInteger(input.count) || input.count <= 0) {
      throw new SecondHandCoinPurchaseInvalidInputError(
        'Coin purchase count must be a positive integer',
      );
    }
    if (input.purchaseUnitPriceRial <= 0n) {
      throw new SecondHandCoinPurchaseInvalidInputError(
        'Coin purchase unit price must be positive',
      );
    }
    if (input.paidRial < 0n) {
      throw new SecondHandCoinPurchaseInvalidInputError('Paid Rial cannot be negative');
    }

    const [party, version, quote, baseQuoteKarat, mithqalGrams] = await Promise.all([
      this.parties.findActiveInTransaction(transaction, input.tenantId, input.partyId),
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

    if (party === undefined) {
      throw new SecondHandPurchasePartyNotFoundError();
    }
    if (party.type !== 'CONSUMER') {
      throw new SecondHandPurchasePartyNotConsumerError();
    }
    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new SecondHandPurchaseQuoteNotFoundError();
    }

    const baseKarat = positiveIntegerSetting(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat);
    if (baseKarat > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SecondHandPurchasePricingSettingInvalidError(SETTING_KEYS.baseQuoteKarat);
    }

    const goldRate1000Rial = gramRate1000(
      quote.amountRial,
      rateDivisorFromMarketSettings(karat(toSafeNumber(baseKarat)), mithqalGramsX10k(mithqalGrams)),
    );
    const coin = toCoinType(version);
    const purchaseUnitPriceRial = rial(input.purchaseUnitPriceRial);
    const intrinsicValueRial = intrinsicValue(coin, goldRate1000Rial);
    const bubbleRial = coin.isCentralBankMinted
      ? bubble(coin, purchaseUnitPriceRial, goldRate1000Rial)
      : null;
    const purchaseAmountRial = coinPositionValue(input.count, purchaseUnitPriceRial);

    if (input.paidRial > purchaseAmountRial) {
      throw new SecondHandPurchasePaidRialExceedsAmountError();
    }
    const payableRial = purchaseAmountRial - input.paidRial;

    const [purchase] = await transaction
      .insert(secondHandPurchases)
      .values({
        tenantId: input.tenantId,
        partyId: party.id,
        sourceInvoiceId: null,
        lockedQuoteId: quote.id,
        lockedQuoteAmountRial: quote.amountRial,
        lockedQuoteObservedAt: quote.observedAt,
        settingsSnapshot: {
          coinTypeVersionId: version.id,
          purchaseUnitPriceRial: purchaseUnitPriceRial.toString(),
          goldRate1000Rial: goldRate1000Rial.toString(),
          intrinsicValueRial: intrinsicValueRial.toString(),
          bubbleRial: bubbleRial === null ? null : bubbleRial.toString(),
          baseQuoteKarat: settingString(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat),
          mithqalGrams: settingString(mithqalGrams, SETTING_KEYS.mithqalGrams),
        },
        sellerIdentitySnapshot: {
          partyType: party.type,
          displayName: party.displayName,
          mobile: party.mobile,
          nationalId: party.nationalId,
        },
        feeRial: 0n,
        finalAmountRial: purchaseAmountRial,
        effectiveAt: input.effectiveAt,
        finalizedAt: new Date(),
        createdBy: input.createdBy,
      })
      .returning();
    const createdPurchase = purchase!;

    await transaction.insert(secondHandPurchaseItems).values({
      tenantId: input.tenantId,
      secondHandPurchaseId: createdPurchase.id,
      itemType: 'COIN',
      destinationInventoryType: 'COIN',
      coinTypeId: input.coinTypeId,
      coinCount: input.count,
      itemSnapshot: {
        coinTypeVersionId: version.id,
        count: input.count.toString(),
        purchaseUnitPriceRial: purchaseUnitPriceRial.toString(),
        purchaseAmountRial: purchaseAmountRial.toString(),
        goldRate1000Rial: goldRate1000Rial.toString(),
        intrinsicValueRial: intrinsicValueRial.toString(),
        bubbleRial: bubbleRial === null ? null : bubbleRial.toString(),
      },
    });

    const quantity = BigInt(input.count);
    const movement = await this.movements.recordInTransaction(transaction, input.tenantId, {
      sourceType: 'SECOND_HAND_PURCHASE',
      sourceId: createdPurchase.id,
      itemType: 'COIN',
      itemId: input.coinTypeId,
      quantity,
      occurredAt: input.effectiveAt,
    });

    const [cash, purchaseFromConsumer, coinInventory, partyAccounts, rialDimension] =
      await Promise.all([
        this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'CASH'),
        this.accounts.getRequiredSystemAccountInTransaction(
          transaction,
          input.tenantId,
          'PURCHASE_FROM_CONSUMER',
        ),
        this.accounts.getRequiredSystemAccountInTransaction(
          transaction,
          input.tenantId,
          `INVENTORY_COIN:${input.coinTypeId}`,
        ),
        this.accounts.ensurePartyAccountsInTransaction(transaction, {
          tenantId: input.tenantId,
          partyId: party.id,
        }),
        this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'RIAL'),
      ]);

    const entries: LedgerPostingEntryInput[] = [
      {
        accountId: purchaseFromConsumer.id,
        dimensionId: rialDimension.id,
        quantity: purchaseAmountRial,
      },
      ...(input.paidRial === 0n
        ? []
        : [{ accountId: cash.id, dimensionId: rialDimension.id, quantity: -input.paidRial }]),
      ...(payableRial === 0n
        ? []
        : [
            {
              accountId: partyAccounts.payable.id,
              dimensionId: rialDimension.id,
              quantity: -payableRial,
            },
          ]),
      {
        accountId: coinInventory.id,
        dimensionId: movement.dimensionId,
        quantity,
      },
      {
        accountId: purchaseFromConsumer.id,
        dimensionId: movement.dimensionId,
        quantity: -quantity,
      },
    ];
    const posting = await this.ledger.postInTransaction(transaction, {
      source: { tenantId: input.tenantId, type: 'SECOND_HAND_PURCHASE', id: createdPurchase.id },
      effectiveAt: input.effectiveAt,
      description: `Second-hand coin purchase ${createdPurchase.id}`,
      createdBy: input.createdBy,
      entries,
    });

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy,
      action: 'SECOND_HAND_COIN_PURCHASE_CREATED',
      entityType: 'second_hand_purchase',
      entityId: createdPurchase.id,
      afterData: {
        partyId: party.id,
        coinTypeId: input.coinTypeId,
        count: input.count.toString(),
        purchaseUnitPriceRial: purchaseUnitPriceRial.toString(),
        purchaseAmountRial: purchaseAmountRial.toString(),
        paidRial: input.paidRial.toString(),
        payableRial: payableRial.toString(),
      },
    });

    return {
      secondHandPurchaseId: createdPurchase.id,
      ledgerTransactionId: posting.transaction.id,
      inventoryMovementId: movement.id,
      coinTypeId: input.coinTypeId,
      count: input.count,
      purchaseUnitPriceRial,
      purchaseAmountRial,
      paidRial: input.paidRial,
      payableRial,
      intrinsicValueRial,
      bubbleRial,
    };
  }
}
