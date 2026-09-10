import { z } from 'zod';
import {
  bigIntStringSchema,
  isoDateTimeSchema,
  nonNegativeBigIntStringSchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';

/**
 * A B2C buyback is a new second-hand gold purchase tied to an earlier invoice.
 * The caller can report the returned article’s newly measured weights, but
 * cannot choose the original party, invoice amount, or any sale-side amount.
 */
export const createB2cBuybackSchema = z
  .object({
    grossWeightMg: positiveBigIntStringSchema,
    stoneWeightMg: nonNegativeBigIntStringSchema.default('0'),
    otherDeductionWeightMg: nonNegativeBigIntStringSchema.default('0'),
    /** Omit to use the effective, tenant-configured consumer-purchase karat. */
    purchaseKarat: z.number().int().min(1).max(1000).optional(),
    quoteId: uuidSchema,
    paidRial: nonNegativeBigIntStringSchema.default('0'),
    effectiveAt: isoDateTimeSchema,
  })
  .strict();

/**
 * Read-only pricing request for the Buyback comparison screen. It intentionally
 * omits payment because previewing a purchase must not create a payment, a
 * purchase document, an inventory movement, or a ledger transaction.
 */
export const previewB2cBuybackSchema = createB2cBuybackSchema.omit({ paidRial: true });

/**
 * `differenceRial` and the three difference effects are signed. A positive
 * value increases today’s purchase amount compared with the prior sale.
 * `wageBurnedRial` is a positive display amount and is subtracted in the
 * documented breakdown equation.
 */
export const b2cBuybackBreakdownSchema = z.object({
  originalPurchaseAmountRial: positiveBigIntStringSchema,
  todayPurchaseAmountRial: positiveBigIntStringSchema,
  differenceRial: bigIntStringSchema,
  wageBurnedRial: nonNegativeBigIntStringSchema,
  karatDifferenceRial: bigIntStringSchema,
  marketPriceDifferenceRial: bigIntStringSchema,
  otherCalculationDifferenceRial: bigIntStringSchema,
});

/** Locked information for one side of a B2C Buyback comparison. */
export const b2cBuybackComparisonEventSchema = z.object({
  effectiveAt: isoDateTimeSchema,
  quoteAmountRial: positiveBigIntStringSchema,
  quoteObservedAt: isoDateTimeSchema,
  goldRatePerGramRial: positiveBigIntStringSchema,
  purchaseAmountRial: positiveBigIntStringSchema,
});

/**
 * Server-calculated, side-effect-free comparison of the original jewelry sale
 * and a newly measured second-hand purchase. Both event snapshots are carried
 * explicitly so the browser never substitutes today's market rate for history.
 */
export const b2cBuybackPreviewSchema = z.object({
  sourceInvoiceId: uuidSchema,
  original: b2cBuybackComparisonEventSchema,
  today: b2cBuybackComparisonEventSchema,
  breakdown: b2cBuybackBreakdownSchema,
});

export const b2cBuybackSchema = z.object({
  secondHandPurchaseId: uuidSchema,
  ledgerTransactionId: uuidSchema,
  inventoryMovementId: uuidSchema,
  sourceInvoiceId: uuidSchema,
  pureWeightMg: positiveBigIntStringSchema,
  goldRatePerGramRial: positiveBigIntStringSchema,
  paidRial: nonNegativeBigIntStringSchema,
  payableRial: nonNegativeBigIntStringSchema,
  breakdown: b2cBuybackBreakdownSchema,
});

export type CreateB2cBuybackInput = z.infer<typeof createB2cBuybackSchema>;
export type PreviewB2cBuybackInput = z.infer<typeof previewB2cBuybackSchema>;
export type B2cBuybackBreakdown = z.infer<typeof b2cBuybackBreakdownSchema>;
export type B2cBuybackComparisonEvent = z.infer<typeof b2cBuybackComparisonEventSchema>;
export type B2cBuybackPreview = z.infer<typeof b2cBuybackPreviewSchema>;
export type B2cBuyback = z.infer<typeof b2cBuybackSchema>;
