import { z } from 'zod';
import { isoDateTimeSchema, positiveBigIntStringSchema, uuidSchema } from '../common/index.js';

/**
 * دریافت طلا برای تسویه‌ی طلب ریالی — BE-046.
 *
 * وزن ناخالص و تمام مبالغ در مرز JSON رشته‌اند. سرور وزن را با عیار داده‌شده
 * به میلی‌گرم خالص ۱۰۰۰ تبدیل می‌کند و نرخ تبدیل را از quote انتخاب‌شده قفل
 * می‌کند؛ کلاینت هرگز مقدار تسویه‌شده را تعیین نمی‌کند.
 */
export const createGoldSettlementSchema = z
  .object({
    grossWeightMg: positiveBigIntStringSchema,
    karat: z.number().int().min(1).max(1000),
    quoteId: uuidSchema,
    effectiveAt: isoDateTimeSchema,
  })
  .strict();

export const goldSettlementSchema = z.object({
  settlementId: uuidSchema,
  ledgerTransactionId: uuidSchema,
  inventoryMovementId: uuidSchema,
  pureWeightMg: positiveBigIntStringSchema,
  settledRial: positiveBigIntStringSchema,
  goldRatePerGramRial: positiveBigIntStringSchema,
});

export type CreateGoldSettlementInput = z.infer<typeof createGoldSettlementSchema>;
export type GoldSettlement = z.infer<typeof goldSettlementSchema>;
