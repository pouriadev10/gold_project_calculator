import { z } from 'zod';
import {
  bigIntStringSchema,
  isoDateTimeSchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';

const mixedRialSettlementLineSchema = z
  .object({ type: z.literal('RIAL'), amountRial: positiveBigIntStringSchema })
  .strict();

const mixedGoldSettlementLineSchema = z
  .object({
    type: z.literal('GOLD'),
    grossWeightMg: positiveBigIntStringSchema,
    karat: z.number().int().min(1).max(1000),
    quoteId: uuidSchema,
  })
  .strict();

const mixedCoinSettlementLineSchema = z
  .object({
    type: z.literal('COIN'),
    coinTypeId: uuidSchema,
    count: z.number().int().positive(),
    marketUnitPriceRial: positiveBigIntStringSchema,
    quoteId: uuidSchema,
  })
  .strict();

/** Uses the party's existing RIAL credit (payable) balance against its receivable. */
const mixedCreditSettlementLineSchema = z
  .object({ type: z.literal('CREDIT'), amountRial: positiveBigIntStringSchema })
  .strict();

export const mixedSettlementLineSchema = z.discriminatedUnion('type', [
  mixedRialSettlementLineSchema,
  mixedGoldSettlementLineSchema,
  mixedCoinSettlementLineSchema,
  mixedCreditSettlementLineSchema,
]);

/**
 * Every line belongs to one atomic settlement. Money and weight remain JSON
 * strings; only the countable `COIN` position is an integer.
 */
export const createMixedSettlementSchema = z
  .object({
    lines: z.array(mixedSettlementLineSchema).min(1),
    effectiveAt: isoDateTimeSchema,
  })
  .strict();

const mixedRialSettlementResultLineSchema = z.object({
  type: z.literal('RIAL'),
  settledRial: positiveBigIntStringSchema,
});

const mixedGoldSettlementResultLineSchema = z.object({
  type: z.literal('GOLD'),
  inventoryMovementId: uuidSchema,
  pureWeightMg: positiveBigIntStringSchema,
  settledRial: positiveBigIntStringSchema,
  goldRatePerGramRial: positiveBigIntStringSchema,
});

const mixedCoinSettlementResultLineSchema = z.object({
  type: z.literal('COIN'),
  inventoryMovementId: uuidSchema,
  coinTypeId: uuidSchema,
  count: z.number().int().positive(),
  settledRial: positiveBigIntStringSchema,
  intrinsicValueRial: positiveBigIntStringSchema,
  bubbleRial: bigIntStringSchema.nullable(),
});

const mixedCreditSettlementResultLineSchema = z.object({
  type: z.literal('CREDIT'),
  settledRial: positiveBigIntStringSchema,
});

export const mixedSettlementResultLineSchema = z.discriminatedUnion('type', [
  mixedRialSettlementResultLineSchema,
  mixedGoldSettlementResultLineSchema,
  mixedCoinSettlementResultLineSchema,
  mixedCreditSettlementResultLineSchema,
]);

export const mixedSettlementSchema = z.object({
  settlementId: uuidSchema,
  ledgerTransactionId: uuidSchema,
  totalSettledRial: positiveBigIntStringSchema,
  lines: z.array(mixedSettlementResultLineSchema).min(1),
});

export type CreateMixedSettlementInput = z.infer<typeof createMixedSettlementSchema>;
export type MixedSettlement = z.infer<typeof mixedSettlementSchema>;
