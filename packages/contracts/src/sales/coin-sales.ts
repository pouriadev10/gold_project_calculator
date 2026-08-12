import { z } from 'zod';
import {
  bigIntStringSchema,
  isoDateTimeSchema,
  nonNegativeBigIntStringSchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';

/**
 * فروش سکه — BE-043. تعداد سکه `integer` است (قاعده‌ی ۲-۱)، نه رشته‌ی BigInt؛
 * سکه هرگز به وزن یا گرم تبدیل نمی‌شود. `paidRial` اختیار نیست: اگر کمتر از
 * مبلغ محاسبه‌شده باشد، مانده روی حساب دریافتنی شخص می‌نشیند.
 */
export const createCoinSaleSchema = z
  .object({
    partyId: uuidSchema,
    coinTypeId: uuidSchema,
    count: z.number().int().positive(),
    marketUnitPriceRial: positiveBigIntStringSchema,
    quoteId: uuidSchema,
    effectiveAt: isoDateTimeSchema,
    paidRial: nonNegativeBigIntStringSchema,
  })
  .strict();

export const coinSaleSchema = z.object({
  invoiceId: uuidSchema,
  invoiceNumber: z.number().int().positive(),
  payableRial: nonNegativeBigIntStringSchema,
  receivableRial: nonNegativeBigIntStringSchema,
  intrinsicValueRial: nonNegativeBigIntStringSchema,
  /** فقط برای سکه‌ی ضرب بانک مرکزی مقدار دارد؛ در غیر این صورت `null` — قانون حباب. */
  bubbleRial: bigIntStringSchema.nullable(),
  ledgerTransactionId: uuidSchema,
  inventoryMovementId: uuidSchema,
});

export type CreateCoinSaleInput = z.infer<typeof createCoinSaleSchema>;
export type CoinSale = z.infer<typeof coinSaleSchema>;
