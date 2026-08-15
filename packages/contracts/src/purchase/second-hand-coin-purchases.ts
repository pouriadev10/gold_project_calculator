import { z } from 'zod';
import {
  bigIntStringSchema,
  isoDateTimeSchema,
  nonNegativeBigIntStringSchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';

/**
 * A coin remains a countable asset: `count` is the only physical quantity in
 * this contract. `purchaseUnitPriceRial` is intentionally distinct from a
 * sale price, so the tenant can buy a coin at a different market rate.
 */
export const createSecondHandCoinPurchaseSchema = z
  .object({
    partyId: uuidSchema,
    coinTypeId: uuidSchema,
    count: z.number().int().positive(),
    purchaseUnitPriceRial: positiveBigIntStringSchema,
    quoteId: uuidSchema,
    paidRial: nonNegativeBigIntStringSchema.default('0'),
    effectiveAt: isoDateTimeSchema,
  })
  .strict();

export const secondHandCoinPurchaseSchema = z.object({
  secondHandPurchaseId: uuidSchema,
  ledgerTransactionId: uuidSchema,
  inventoryMovementId: uuidSchema,
  coinTypeId: uuidSchema,
  count: z.number().int().positive(),
  purchaseUnitPriceRial: positiveBigIntStringSchema,
  purchaseAmountRial: positiveBigIntStringSchema,
  paidRial: nonNegativeBigIntStringSchema,
  payableRial: nonNegativeBigIntStringSchema,
  intrinsicValueRial: bigIntStringSchema,
  /** Present only for a central-bank minted coin; never inferred for another asset. */
  bubbleRial: bigIntStringSchema.nullable(),
});

export type CreateSecondHandCoinPurchaseInput = z.infer<typeof createSecondHandCoinPurchaseSchema>;
export type SecondHandCoinPurchase = z.infer<typeof secondHandCoinPurchaseSchema>;
