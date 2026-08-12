import { z } from 'zod';
import { isoDateTimeSchema, positiveBigIntStringSchema, uuidSchema } from '../common/index.js';

/** پرداخت ریالی مشتری روی طلب خودش — BE-045. تک‌بعدی؛ بدون تبدیل واحد. */
export const createRialSettlementSchema = z
  .object({
    amountRial: positiveBigIntStringSchema,
    effectiveAt: isoDateTimeSchema,
  })
  .strict();

export const rialSettlementSchema = z.object({
  settlementId: uuidSchema,
  ledgerTransactionId: uuidSchema,
  amountRial: positiveBigIntStringSchema,
});

export type CreateRialSettlementInput = z.infer<typeof createRialSettlementSchema>;
export type RialSettlement = z.infer<typeof rialSettlementSchema>;
