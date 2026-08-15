import { z } from 'zod';
import {
  bigIntStringSchema,
  isoDateTimeSchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';

/**
 * دریافت سکه برای تسویه‌ی طلب ریالی — BE-047.
 *
 * `count` همیشه تعداد صحیح سکه است؛ نه وزن و نه رشته‌ی bigint. نرخ بازار و
 * مظنه فقط برای ارزش‌گذاری ریالی استفاده می‌شوند و هر دو در سند قفل می‌شوند.
 */
export const createCoinSettlementSchema = z
  .object({
    coinTypeId: uuidSchema,
    count: z.number().int().positive(),
    marketUnitPriceRial: positiveBigIntStringSchema,
    quoteId: uuidSchema,
    effectiveAt: isoDateTimeSchema,
  })
  .strict();

export const coinSettlementSchema = z.object({
  settlementId: uuidSchema,
  ledgerTransactionId: uuidSchema,
  inventoryMovementId: uuidSchema,
  coinTypeId: uuidSchema,
  count: z.number().int().positive(),
  settledRial: positiveBigIntStringSchema,
  intrinsicValueRial: positiveBigIntStringSchema,
  /** فقط برای سکه‌ی ضرب بانک مرکزی؛ قانون حباب. */
  bubbleRial: bigIntStringSchema.nullable(),
});

export type CreateCoinSettlementInput = z.infer<typeof createCoinSettlementSchema>;
export type CoinSettlement = z.infer<typeof coinSettlementSchema>;
