import { z } from 'zod';
import {
  isoDateTimeSchema,
  nonNegativeBigIntStringSchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';

/**
 * Purchase price inputs stay strings at the JSON boundary. `purchaseKarat` is
 * optional: the API reads the tenant's effective, versioned default when it
 * is omitted. `paidRial` is what is paid now; the remainder becomes a payable
 * balance for the consumer.
 */
export const createSecondHandGoldPurchaseSchema = z
  .object({
    partyId: uuidSchema,
    grossWeightMg: positiveBigIntStringSchema,
    stoneWeightMg: nonNegativeBigIntStringSchema.default('0'),
    otherDeductionWeightMg: nonNegativeBigIntStringSchema.default('0'),
    purchaseKarat: z.number().int().min(1).max(1000).optional(),
    quoteId: uuidSchema,
    feeRial: nonNegativeBigIntStringSchema.default('0'),
    paidRial: nonNegativeBigIntStringSchema.default('0'),
    effectiveAt: isoDateTimeSchema,
  })
  .strict();

export const secondHandGoldPurchaseSchema = z.object({
  secondHandPurchaseId: uuidSchema,
  ledgerTransactionId: uuidSchema,
  inventoryMovementId: uuidSchema,
  pureWeightMg: positiveBigIntStringSchema,
  goldRatePerGramRial: positiveBigIntStringSchema,
  grossPurchaseAmountRial: positiveBigIntStringSchema,
  feeRial: nonNegativeBigIntStringSchema,
  finalAmountRial: positiveBigIntStringSchema,
  paidRial: nonNegativeBigIntStringSchema,
  payableRial: nonNegativeBigIntStringSchema,
});

export type CreateSecondHandGoldPurchaseInput = z.infer<typeof createSecondHandGoldPurchaseSchema>;
export type SecondHandGoldPurchase = z.infer<typeof secondHandGoldPurchaseSchema>;
