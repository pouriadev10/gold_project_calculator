import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  CalcError,
  calculateB2cBuybackDifference,
  calculateJewelrySale,
  grossMg,
  karat,
  rateDivisorFromMarketSettings,
  rial,
  toSafeNumber,
} from '@gold/core-calc';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  jewelryItemVersions,
  salesInvoiceItems,
  salesInvoiceVersions,
  salesInvoices,
} from '../../platform/database/schema';
import { PartiesService } from '../parties/parties.service';
import { SecondHandGoldPurchasesService } from './second-hand-gold-purchases.service';
import {
  B2cBuybackInvoiceNotFinalizedError,
  B2cBuybackInvoiceNotFoundError,
  B2cBuybackPartyNotAvailableError,
  B2cBuybackPartyNotConsumerError,
  B2cBuybackSourceItemsUnsupportedError,
  B2cBuybackSourceSnapshotInvalidError,
  B2cBuybackSourceSnapshotMismatchError,
} from './b2c-buybacks.errors';
import type { B2cBuybackDifference, JewelrySaleCalculation, Rial } from '@gold/core-calc';
import type { Database } from '../../platform/database/connect';
import type { JewelryItemVersion, SalesInvoiceSnapshotValue } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

const HISTORICAL_SETTING_KEYS = {
  baseQuoteKarat: 'baseQuoteKarat',
  mithqalGrams: 'mithqalGrams',
  roundingUnitRial: 'roundingUnitRial',
  roundingPolicy: 'roundingPolicy',
  profitRateBps: 'profitRateBps',
  taxRateBps: 'taxRateBps',
} as const;

export interface CreateB2cBuybackInput {
  readonly tenantId: string;
  readonly sourceInvoiceId: string;
  readonly grossWeightMg: bigint;
  readonly stoneWeightMg: bigint;
  readonly otherDeductionWeightMg: bigint;
  readonly purchaseKarat?: number | undefined;
  readonly quoteId: string;
  readonly paidRial: bigint;
  readonly effectiveAt: Date;
  readonly createdBy: string;
}

export interface CreatedB2cBuyback {
  readonly secondHandPurchaseId: string;
  readonly ledgerTransactionId: string;
  readonly inventoryMovementId: string;
  readonly sourceInvoiceId: string;
  readonly pureWeightMg: bigint;
  readonly goldRatePerGramRial: bigint;
  readonly paidRial: bigint;
  readonly payableRial: bigint;
  readonly originalPurchaseAmountRial: bigint;
  readonly todayPurchaseAmountRial: bigint;
  readonly breakdown: B2cBuybackDifference;
}

interface OriginalJewelrySale {
  readonly partyId: string;
  readonly originalPurchaseAmountRial: Rial;
  readonly calculation: JewelrySaleCalculation;
  readonly effectiveAt: Date;
  readonly quoteAmountRial: bigint;
  readonly quoteObservedAt: Date;
}

export interface PreviewB2cBuybackInput {
  readonly tenantId: string;
  readonly sourceInvoiceId: string;
  readonly grossWeightMg: bigint;
  readonly stoneWeightMg: bigint;
  readonly otherDeductionWeightMg: bigint;
  readonly purchaseKarat?: number | undefined;
  readonly quoteId: string;
  readonly effectiveAt: Date;
}

export interface PreviewedB2cBuyback {
  readonly sourceInvoiceId: string;
  readonly original: {
    readonly effectiveAt: Date;
    readonly quoteAmountRial: bigint;
    readonly quoteObservedAt: Date;
    readonly goldRatePerGramRial: bigint;
    readonly purchaseAmountRial: bigint;
  };
  readonly today: {
    readonly effectiveAt: Date;
    readonly quoteAmountRial: bigint;
    readonly quoteObservedAt: Date;
    readonly goldRatePerGramRial: bigint;
    readonly purchaseAmountRial: bigint;
  };
  readonly breakdown: B2cBuybackDifference;
}

function isSnapshotRecord(
  value: SalesInvoiceSnapshotValue,
): value is { readonly [key: string]: SalesInvoiceSnapshotValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function snapshotRecord(value: SalesInvoiceSnapshotValue, context: string) {
  if (!isSnapshotRecord(value)) {
    throw new B2cBuybackSourceSnapshotInvalidError(`${context} must be a JSON object`);
  }

  return value;
}

function snapshotString(
  snapshot: { readonly [key: string]: SalesInvoiceSnapshotValue },
  key: string,
): string {
  const value = snapshot[key];
  if (typeof value !== 'string') {
    throw new B2cBuybackSourceSnapshotInvalidError(
      `Source invoice snapshot is missing string field "${key}"`,
    );
  }

  return value;
}

function nonNegativeSnapshotRial(
  snapshot: { readonly [key: string]: SalesInvoiceSnapshotValue },
  key: string,
): bigint {
  const value = snapshotString(snapshot, key);
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    throw new B2cBuybackSourceSnapshotInvalidError(
      `Source invoice snapshot field "${key}" must be a non-negative integer string`,
    );
  }

  return BigInt(value);
}

function positiveSnapshotRial(
  snapshot: { readonly [key: string]: SalesInvoiceSnapshotValue },
  key: string,
): bigint {
  const value = nonNegativeSnapshotRial(snapshot, key);
  if (value === 0n) {
    throw new B2cBuybackSourceSnapshotInvalidError(
      `Source invoice snapshot field "${key}" must be positive`,
    );
  }

  return value;
}

function mithqalGramsX10k(value: string): bigint {
  const match = /^(\d+)\.(\d{4})$/u.exec(value);
  if (match === null || BigInt(match[1]!) <= 0n) {
    throw new B2cBuybackSourceSnapshotInvalidError(
      'Source invoice has an invalid historical mithqal setting',
    );
  }

  return BigInt(`${match[1]}${match[2]}`);
}

function historicalCalculation(
  invoiceTotals: SalesInvoiceSnapshotValue,
  invoiceSettings: SalesInvoiceSnapshotValue,
  itemVersion: JewelryItemVersion,
  originalMaznehRial: bigint,
): { readonly originalPurchaseAmountRial: Rial; readonly calculation: JewelrySaleCalculation } {
  const totals = snapshotRecord(invoiceTotals, 'Source invoice totals snapshot');
  const settings = snapshotRecord(invoiceSettings, 'Source invoice settings snapshot');
  const originalPurchaseAmountRial = positiveSnapshotRial(totals, 'payableRial') as Rial;
  const baseQuoteKarat = positiveSnapshotRial(settings, HISTORICAL_SETTING_KEYS.baseQuoteKarat);
  const roundingUnitRial = positiveSnapshotRial(settings, HISTORICAL_SETTING_KEYS.roundingUnitRial);
  const profitRateBps = nonNegativeSnapshotRial(settings, HISTORICAL_SETTING_KEYS.profitRateBps);
  const taxRateBps = nonNegativeSnapshotRial(settings, HISTORICAL_SETTING_KEYS.taxRateBps);
  const roundingPolicy = snapshotString(settings, HISTORICAL_SETTING_KEYS.roundingPolicy);
  if (roundingPolicy !== 'HALF_UP') {
    throw new B2cBuybackSourceSnapshotInvalidError(
      'Source invoice has an unsupported historical rounding policy',
    );
  }
  if (baseQuoteKarat > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new B2cBuybackSourceSnapshotInvalidError(
      'Source invoice has an unsafe historical base-quote karat',
    );
  }

  let calculation: JewelrySaleCalculation;
  try {
    calculation = calculateJewelrySale({
      grossWeightMg: itemVersion.grossWeightMg,
      karat: karat(itemVersion.karat),
      deductions: {
        stone: grossMg(itemVersion.stoneWeightMg),
        other: grossMg(itemVersion.otherDeductionWeightMg),
      },
      wageType: itemVersion.wageType,
      wageValue: itemVersion.wageValue,
      maznehRial: originalMaznehRial,
      profitRateBps,
      taxRateBps,
      roundingUnitRial,
      rateDivisor: rateDivisorFromMarketSettings(
        karat(toSafeNumber(baseQuoteKarat)),
        mithqalGramsX10k(snapshotString(settings, HISTORICAL_SETTING_KEYS.mithqalGrams)),
      ),
    });
  } catch (error) {
    if (error instanceof CalcError) {
      throw new B2cBuybackSourceSnapshotInvalidError(error.message);
    }
    throw error;
  }

  if (calculation.payableRial !== originalPurchaseAmountRial) {
    throw new B2cBuybackSourceSnapshotMismatchError();
  }

  return { originalPurchaseAmountRial, calculation };
}

/**
 * B2C buyback is a new consumer purchase, never a reversal of the original
 * sale. The original finalized invoice is queried only to establish its party
 * and to produce a signed, explanatory difference breakdown.
 */
@Injectable()
export class B2cBuybacksService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PartiesService) private readonly parties: PartiesService,
    @Inject(SecondHandGoldPurchasesService)
    private readonly goldPurchases: SecondHandGoldPurchasesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Prices a Buyback in a tenant-scoped read-only transaction. This is not a
   * draft purchase: it creates no document, inventory movement, ledger entry,
   * idempotency record, or audit event.
   */
  async preview(input: PreviewB2cBuybackInput): Promise<PreviewedB2cBuyback> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.previewInTransaction(transaction, input),
    );
  }

  async previewInTransaction(
    transaction: TenantTransaction,
    input: PreviewB2cBuybackInput,
  ): Promise<PreviewedB2cBuyback> {
    const original = await this.loadOriginalJewelrySaleInTransaction(transaction, input);
    const today = await this.goldPurchases.previewInTransaction(transaction, {
      tenantId: input.tenantId,
      grossWeightMg: input.grossWeightMg,
      stoneWeightMg: input.stoneWeightMg,
      otherDeductionWeightMg: input.otherDeductionWeightMg,
      purchaseKarat: input.purchaseKarat,
      quoteId: input.quoteId,
      feeRial: 0n,
      effectiveAt: input.effectiveAt,
    });
    const breakdown = calculateB2cBuybackDifference({
      originalPurchaseAmountRial: original.originalPurchaseAmountRial,
      originalGoldValueRial: original.calculation.goldValueRial,
      originalWageRial: original.calculation.wageRial,
      originalPureWeightMg: original.calculation.pureWeightMg,
      todayGrossPurchaseAmountRial: rial(today.grossPurchaseAmountRial),
      todayPurchaseAmountRial: rial(today.finalAmountRial),
      todayGoldRatePerGramRial: rial(today.goldRatePerGramRial),
    });

    return {
      sourceInvoiceId: input.sourceInvoiceId,
      original: {
        effectiveAt: original.effectiveAt,
        quoteAmountRial: original.quoteAmountRial,
        quoteObservedAt: original.quoteObservedAt,
        goldRatePerGramRial: original.calculation.goldRatePerGramRial,
        purchaseAmountRial: original.originalPurchaseAmountRial,
      },
      today: {
        effectiveAt: input.effectiveAt,
        quoteAmountRial: today.quoteAmountRial,
        quoteObservedAt: today.quoteObservedAt,
        goldRatePerGramRial: today.goldRatePerGramRial,
        purchaseAmountRial: today.finalAmountRial,
      },
      breakdown,
    };
  }

  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateB2cBuybackInput,
  ): Promise<CreatedB2cBuyback> {
    const original = await this.loadOriginalJewelrySaleInTransaction(transaction, input);
    const purchase = await this.goldPurchases.createInTransaction(transaction, {
      tenantId: input.tenantId,
      partyId: original.partyId,
      grossWeightMg: input.grossWeightMg,
      stoneWeightMg: input.stoneWeightMg,
      otherDeductionWeightMg: input.otherDeductionWeightMg,
      purchaseKarat: input.purchaseKarat,
      sourceInvoiceId: input.sourceInvoiceId,
      quoteId: input.quoteId,
      feeRial: 0n,
      paidRial: input.paidRial,
      effectiveAt: input.effectiveAt,
      createdBy: input.createdBy,
    });
    const breakdown = calculateB2cBuybackDifference({
      originalPurchaseAmountRial: original.originalPurchaseAmountRial,
      originalGoldValueRial: original.calculation.goldValueRial,
      originalWageRial: original.calculation.wageRial,
      originalPureWeightMg: original.calculation.pureWeightMg,
      todayGrossPurchaseAmountRial: rial(purchase.grossPurchaseAmountRial),
      todayPurchaseAmountRial: rial(purchase.finalAmountRial),
      todayGoldRatePerGramRial: rial(purchase.goldRatePerGramRial),
    });

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy,
      action: 'B2C_BUYBACK_CREATED',
      entityType: 'second_hand_purchase',
      entityId: purchase.secondHandPurchaseId,
      afterData: {
        sourceInvoiceId: input.sourceInvoiceId,
        originalPurchaseAmountRial: original.originalPurchaseAmountRial.toString(),
        todayPurchaseAmountRial: purchase.finalAmountRial.toString(),
        differenceRial: breakdown.differenceRial.toString(),
        wageBurnedRial: breakdown.wageBurnedRial.toString(),
        karatDifferenceRial: breakdown.karatDifferenceRial.toString(),
        marketPriceDifferenceRial: breakdown.marketPriceDifferenceRial.toString(),
        otherCalculationDifferenceRial: breakdown.otherCalculationDifferenceRial.toString(),
      },
    });

    return {
      secondHandPurchaseId: purchase.secondHandPurchaseId,
      ledgerTransactionId: purchase.ledgerTransactionId,
      inventoryMovementId: purchase.inventoryMovementId,
      sourceInvoiceId: input.sourceInvoiceId,
      pureWeightMg: purchase.pureWeightMg,
      goldRatePerGramRial: purchase.goldRatePerGramRial,
      paidRial: purchase.paidRial,
      payableRial: purchase.payableRial,
      originalPurchaseAmountRial: original.originalPurchaseAmountRial,
      todayPurchaseAmountRial: purchase.finalAmountRial,
      breakdown,
    };
  }

  private async loadOriginalJewelrySaleInTransaction(
    transaction: TenantTransaction,
    input: Pick<CreateB2cBuybackInput, 'tenantId' | 'sourceInvoiceId'>,
  ): Promise<OriginalJewelrySale> {
    const [invoice] = await transaction
      .select()
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.tenantId, input.tenantId),
          eq(salesInvoices.id, input.sourceInvoiceId),
        ),
      )
      .limit(1);
    if (invoice === undefined) {
      throw new B2cBuybackInvoiceNotFoundError();
    }
    if (
      invoice.status !== 'FINALIZED' ||
      invoice.quoteAmountRial === null ||
      invoice.quoteObservedAt === null ||
      invoice.finalizedAt === null
    ) {
      throw new B2cBuybackInvoiceNotFinalizedError();
    }

    const party = await this.parties.findActiveInTransaction(
      transaction,
      input.tenantId,
      invoice.partyId,
    );
    if (party === undefined) {
      throw new B2cBuybackPartyNotAvailableError();
    }
    if (party.type !== 'CONSUMER') {
      throw new B2cBuybackPartyNotConsumerError();
    }

    const [invoiceVersion] = await transaction
      .select()
      .from(salesInvoiceVersions)
      .where(
        and(
          eq(salesInvoiceVersions.tenantId, input.tenantId),
          eq(salesInvoiceVersions.salesInvoiceId, invoice.id),
          eq(salesInvoiceVersions.version, invoice.currentVersion),
        ),
      )
      .limit(1);
    if (invoiceVersion === undefined) {
      throw new B2cBuybackSourceSnapshotInvalidError('Source invoice current version is missing');
    }

    const items = await transaction
      .select()
      .from(salesInvoiceItems)
      .where(
        and(
          eq(salesInvoiceItems.tenantId, input.tenantId),
          eq(salesInvoiceItems.salesInvoiceId, invoice.id),
          eq(salesInvoiceItems.salesInvoiceVersionId, invoiceVersion.id),
        ),
      );
    const item = items[0];
    if (
      items.length !== 1 ||
      item === undefined ||
      item.itemType !== 'JEWELRY' ||
      item.quantity !== 1
    ) {
      throw new B2cBuybackSourceItemsUnsupportedError();
    }

    const lineSnapshot = snapshotRecord(item.lineSnapshot, 'Source invoice jewelry line snapshot');
    const jewelryItemVersionId = snapshotString(lineSnapshot, 'jewelryItemVersionId');
    const [itemVersion] = await transaction
      .select()
      .from(jewelryItemVersions)
      .where(
        and(
          eq(jewelryItemVersions.tenantId, input.tenantId),
          eq(jewelryItemVersions.id, jewelryItemVersionId),
          eq(jewelryItemVersions.jewelryItemId, item.itemId),
        ),
      )
      .limit(1);
    if (itemVersion === undefined) {
      throw new B2cBuybackSourceSnapshotInvalidError(
        'Source invoice jewelry version is not available to this tenant',
      );
    }

    const historical = historicalCalculation(
      invoiceVersion.totalsSnapshot,
      invoiceVersion.settingsSnapshot,
      itemVersion,
      invoice.quoteAmountRial,
    );

    return {
      partyId: party.id,
      originalPurchaseAmountRial: historical.originalPurchaseAmountRial,
      calculation: historical.calculation,
      effectiveAt: invoice.finalizedAt,
      quoteAmountRial: invoice.quoteAmountRial,
      quoteObservedAt: invoice.quoteObservedAt,
    };
  }
}
