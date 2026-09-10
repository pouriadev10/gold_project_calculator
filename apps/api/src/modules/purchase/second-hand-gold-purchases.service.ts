import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  CalcError,
  calculateSecondHandGoldPurchase,
  grossMg,
  karat,
  rateDivisorFromMarketSettings,
  toSafeNumber,
} from '@gold/core-calc';
import { AuditService } from '../../platform/audit/audit.service';
import {
  priceQuotes,
  secondHandPurchaseItems,
  secondHandPurchases,
} from '../../platform/database/schema';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { PartiesService } from '../parties/parties.service';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  SecondHandPurchaseCalculationError,
  SecondHandPurchasePaidRialExceedsAmountError,
  SecondHandPurchasePartyNotConsumerError,
  SecondHandPurchasePartyNotFoundError,
  SecondHandPurchasePricingSettingInvalidError,
  SecondHandPurchaseQuoteNotFoundError,
} from './second-hand-gold-purchases.errors';
import type { LedgerPostingEntryInput } from '../ledger/ledger-posting.service';
import type { VersionedSetting, VersionedSettingValue } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

const SETTING_KEYS = {
  defaultPurchaseKarat: 'purchase.second_hand_default_karat',
  baseQuoteKarat: 'pricing.base_quote_karat',
  mithqalGrams: 'pricing.mithqal_grams',
  roundingUnitRial: 'pricing.rial_rounding_unit',
  roundingPolicy: 'pricing.rounding_policy',
} as const;

export interface CreateSecondHandGoldPurchaseInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly grossWeightMg: bigint;
  readonly stoneWeightMg: bigint;
  readonly otherDeductionWeightMg: bigint;
  /** If omitted, the effective tenant setting determines the karat. */
  readonly purchaseKarat?: number | undefined;
  /** Internal-only link for BE-052; the direct purchase endpoint leaves this empty. */
  readonly sourceInvoiceId?: string | null | undefined;
  readonly quoteId: string;
  readonly feeRial: bigint;
  readonly paidRial: bigint;
  readonly effectiveAt: Date;
  readonly createdBy: string;
}

export interface CreatedSecondHandGoldPurchase {
  readonly secondHandPurchaseId: string;
  readonly ledgerTransactionId: string;
  readonly inventoryMovementId: string;
  readonly pureWeightMg: bigint;
  readonly goldRatePerGramRial: bigint;
  readonly grossPurchaseAmountRial: bigint;
  readonly feeRial: bigint;
  readonly finalAmountRial: bigint;
  readonly paidRial: bigint;
  readonly payableRial: bigint;
}

/**
 * The resolved, side-effect-free price for a consumer gold purchase. This is
 * shared by the Buyback preview and creation flows so their calculation and
 * locked-rate semantics cannot drift apart.
 */
export interface PreviewSecondHandGoldPurchaseInput {
  readonly tenantId: string;
  readonly grossWeightMg: bigint;
  readonly stoneWeightMg: bigint;
  readonly otherDeductionWeightMg: bigint;
  readonly purchaseKarat?: number | undefined;
  readonly quoteId: string;
  readonly feeRial: bigint;
  readonly effectiveAt: Date;
}

export interface PreviewSecondHandGoldPurchase {
  readonly pureWeightMg: bigint;
  readonly goldRatePerGramRial: bigint;
  readonly grossPurchaseAmountRial: bigint;
  readonly feeRial: bigint;
  readonly finalAmountRial: bigint;
  readonly quoteAmountRial: bigint;
  readonly quoteObservedAt: Date;
}

interface ResolvedSecondHandGoldPurchasePricing extends PreviewSecondHandGoldPurchase {
  readonly defaultPurchaseKarat: string;
  readonly effectivePurchaseKarat: ReturnType<typeof karat>;
  readonly baseQuoteKarat: string;
  readonly mithqalGrams: string;
  readonly roundingUnitRial: bigint;
  readonly roundingPolicy: string;
  readonly rateDivisor: bigint;
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

/**
 * Creates a new consumer-purchase source document, its melted-gold movement,
 * and a balanced multi-dimension ledger posting in one caller-owned database
 * transaction. A B2C buyback will later call this same service with a source
 * invoice; this BE-050 flow intentionally creates an unlinked new purchase.
 */
@Injectable()
export class SecondHandGoldPurchasesService {
  constructor(
    @Inject(PartiesService) private readonly parties: PartiesService,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
    @Inject(LedgerPostingService) private readonly ledger: LedgerPostingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Calculates the current purchase from the same quote and versioned settings
   * used by creation. It deliberately performs no insert, ledger posting, or
   * inventory movement.
   */
  async previewInTransaction(
    transaction: TenantTransaction,
    input: PreviewSecondHandGoldPurchaseInput,
  ): Promise<PreviewSecondHandGoldPurchase> {
    const pricing = await this.resolvePricingInTransaction(transaction, input);
    return {
      pureWeightMg: pricing.pureWeightMg,
      goldRatePerGramRial: pricing.goldRatePerGramRial,
      grossPurchaseAmountRial: pricing.grossPurchaseAmountRial,
      feeRial: pricing.feeRial,
      finalAmountRial: pricing.finalAmountRial,
      quoteAmountRial: pricing.quoteAmountRial,
      quoteObservedAt: pricing.quoteObservedAt,
    };
  }

  private async resolvePricingInTransaction(
    transaction: TenantTransaction,
    input: PreviewSecondHandGoldPurchaseInput,
  ): Promise<ResolvedSecondHandGoldPurchasePricing> {
    const [quote, defaultPurchaseKarat, baseQuoteKarat, mithqalGrams, roundingUnit, roundingPolicy] =
      await Promise.all([
        transaction
          .select()
          .from(priceQuotes)
          .where(and(eq(priceQuotes.tenantId, input.tenantId), eq(priceQuotes.id, input.quoteId)))
          .limit(1)
          .then(([found]) => found),
        this.settings.getEffectiveInTransaction(
          transaction,
          input.tenantId,
          SETTING_KEYS.defaultPurchaseKarat,
          input.effectiveAt,
        ),
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
      ]);

    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new SecondHandPurchaseQuoteNotFoundError();
    }
    const roundingPolicyValue = settingString(roundingPolicy, SETTING_KEYS.roundingPolicy);
    if (roundingPolicyValue !== 'HALF_UP') {
      throw new SecondHandPurchasePricingSettingInvalidError(SETTING_KEYS.roundingPolicy);
    }

    const defaultPurchaseKaratValue = settingString(
      defaultPurchaseKarat,
      SETTING_KEYS.defaultPurchaseKarat,
    );
    const effectivePurchaseKarat =
      input.purchaseKarat === undefined
        ? karat(toSafeNumber(positiveIntegerSetting(defaultPurchaseKarat, SETTING_KEYS.defaultPurchaseKarat)))
        : karat(input.purchaseKarat);
    const baseQuoteKaratValue = settingString(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat);
    const baseKarat = karat(
      toSafeNumber(positiveIntegerSetting(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat)),
    );
    const mithqalGramsValue = settingString(mithqalGrams, SETTING_KEYS.mithqalGrams);
    const roundingUnitRial = positiveIntegerSetting(roundingUnit, SETTING_KEYS.roundingUnitRial);
    const rateDivisor = rateDivisorFromMarketSettings(baseKarat, mithqalGramsX10k(mithqalGrams));

    let calculation: ReturnType<typeof calculateSecondHandGoldPurchase>;
    try {
      calculation = calculateSecondHandGoldPurchase({
        grossWeightMg: input.grossWeightMg,
        deductions: {
          stone: grossMg(input.stoneWeightMg),
          other: grossMg(input.otherDeductionWeightMg),
        },
        purchaseKarat: effectivePurchaseKarat,
        maznehRial: quote.amountRial,
        feeRial: input.feeRial,
        roundingUnitRial,
        rateDivisor,
      });
    } catch (error) {
      if (error instanceof CalcError) {
        throw new SecondHandPurchaseCalculationError(error.message);
      }
      throw error;
    }

    return {
      pureWeightMg: calculation.pureWeightMg,
      goldRatePerGramRial: calculation.goldRatePerGramRial,
      grossPurchaseAmountRial: calculation.grossPurchaseAmountRial,
      feeRial: input.feeRial,
      finalAmountRial: calculation.finalAmountRial,
      quoteAmountRial: quote.amountRial,
      quoteObservedAt: quote.observedAt,
      defaultPurchaseKarat: defaultPurchaseKaratValue,
      effectivePurchaseKarat,
      baseQuoteKarat: baseQuoteKaratValue,
      mithqalGrams: mithqalGramsValue,
      roundingUnitRial,
      roundingPolicy: roundingPolicyValue,
      rateDivisor,
    };
  }

  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateSecondHandGoldPurchaseInput,
  ): Promise<CreatedSecondHandGoldPurchase> {
    const [party, pricing] = await Promise.all([
      this.parties.findActiveInTransaction(transaction, input.tenantId, input.partyId),
      this.resolvePricingInTransaction(transaction, input),
    ]);
    const calculation = pricing;
    const quote = {
      id: input.quoteId,
      amountRial: pricing.quoteAmountRial,
      observedAt: pricing.quoteObservedAt,
    };

    if (party === undefined) {
      throw new SecondHandPurchasePartyNotFoundError();
    }
    if (party.type !== 'CONSUMER') {
      throw new SecondHandPurchasePartyNotConsumerError();
    }
    if (input.paidRial > pricing.finalAmountRial) {
      throw new SecondHandPurchasePaidRialExceedsAmountError();
    }
    const payableRial = pricing.finalAmountRial - input.paidRial;

    const [purchase] = await transaction
      .insert(secondHandPurchases)
      .values({
        tenantId: input.tenantId,
        partyId: party.id,
        sourceInvoiceId: input.sourceInvoiceId ?? null,
        lockedQuoteId: quote.id,
        lockedQuoteAmountRial: quote.amountRial,
        lockedQuoteObservedAt: quote.observedAt,
        settingsSnapshot: {
          defaultPurchaseKarat: pricing.defaultPurchaseKarat,
          effectivePurchaseKarat: pricing.effectivePurchaseKarat.toString(),
          baseQuoteKarat: pricing.baseQuoteKarat,
          mithqalGrams: pricing.mithqalGrams,
          roundingUnitRial: pricing.roundingUnitRial.toString(),
          roundingPolicy: pricing.roundingPolicy,
          rateDivisor: pricing.rateDivisor.toString(),
          goldRatePerGramRial: calculation.goldRatePerGramRial.toString(),
        },
        sellerIdentitySnapshot: {
          partyType: party.type,
          displayName: party.displayName,
          mobile: party.mobile,
          nationalId: party.nationalId,
        },
        feeRial: input.feeRial,
        finalAmountRial: calculation.finalAmountRial,
        effectiveAt: input.effectiveAt,
        finalizedAt: new Date(),
        createdBy: input.createdBy,
      })
      .returning();
    const createdPurchase = purchase!;

    await transaction.insert(secondHandPurchaseItems).values({
      tenantId: input.tenantId,
      secondHandPurchaseId: createdPurchase.id,
      itemType: 'GOLD',
      grossWeightMg: input.grossWeightMg,
      stoneWeightMg: input.stoneWeightMg,
      otherDeductionWeightMg: input.otherDeductionWeightMg,
      purchaseKarat: pricing.effectivePurchaseKarat,
      pureWeightMg: calculation.pureWeightMg,
      itemSnapshot: {
        chargeableGrossWeightMg: (
          input.grossWeightMg -
          input.stoneWeightMg -
          input.otherDeductionWeightMg
        ).toString(),
        pureWeightMg: calculation.pureWeightMg.toString(),
        grossPurchaseAmountRial: calculation.grossPurchaseAmountRial.toString(),
        feeRial: input.feeRial.toString(),
        finalAmountRial: calculation.finalAmountRial.toString(),
      },
    });

    const movement = await this.movements.recordInTransaction(transaction, input.tenantId, {
      sourceType: 'SECOND_HAND_PURCHASE',
      sourceId: createdPurchase.id,
      itemType: 'MELTED_GOLD',
      quantity: calculation.pureWeightMg,
      occurredAt: input.effectiveAt,
    });

    const [cash, purchaseFromConsumer, inventoryMeltedGold, partyAccounts, rial, gold] =
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
          'INVENTORY_MELTED_GOLD',
        ),
        this.accounts.ensurePartyAccountsInTransaction(transaction, {
          tenantId: input.tenantId,
          partyId: party.id,
        }),
        this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'RIAL'),
        this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'GOLD'),
      ]);

    const entries: LedgerPostingEntryInput[] = [
      {
        accountId: purchaseFromConsumer.id,
        dimensionId: rial.id,
        quantity: calculation.finalAmountRial,
      },
      ...(input.paidRial === 0n
        ? []
        : [{ accountId: cash.id, dimensionId: rial.id, quantity: -input.paidRial }]),
      ...(payableRial === 0n
        ? []
        : [{ accountId: partyAccounts.payable.id, dimensionId: rial.id, quantity: -payableRial }]),
      {
        accountId: inventoryMeltedGold.id,
        dimensionId: gold.id,
        quantity: calculation.pureWeightMg,
      },
      {
        accountId: purchaseFromConsumer.id,
        dimensionId: gold.id,
        quantity: -calculation.pureWeightMg,
      },
    ];
    const posting = await this.ledger.postInTransaction(transaction, {
      source: { tenantId: input.tenantId, type: 'SECOND_HAND_PURCHASE', id: createdPurchase.id },
      effectiveAt: input.effectiveAt,
      description: `Second-hand gold purchase ${createdPurchase.id}`,
      createdBy: input.createdBy,
      entries,
    });

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy,
      action: 'SECOND_HAND_GOLD_PURCHASE_CREATED',
      entityType: 'second_hand_purchase',
      entityId: createdPurchase.id,
      afterData: {
        partyId: party.id,
        sourceInvoiceId: input.sourceInvoiceId ?? null,
        pureWeightMg: calculation.pureWeightMg.toString(),
        quoteId: quote.id,
        feeRial: input.feeRial.toString(),
        finalAmountRial: calculation.finalAmountRial.toString(),
        paidRial: input.paidRial.toString(),
        payableRial: payableRial.toString(),
      },
    });

    return {
      secondHandPurchaseId: createdPurchase.id,
      ledgerTransactionId: posting.transaction.id,
      inventoryMovementId: movement.id,
      pureWeightMg: calculation.pureWeightMg,
      goldRatePerGramRial: calculation.goldRatePerGramRial,
      grossPurchaseAmountRial: calculation.grossPurchaseAmountRial,
      feeRial: input.feeRial,
      finalAmountRial: calculation.finalAmountRial,
      paidRial: input.paidRial,
      payableRial,
    };
  }
}
