import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/index.js';

export const createJewelryCashSaleSchema = z
  .object({
    partyId: uuidSchema,
    jewelryItemId: uuidSchema,
    quoteId: uuidSchema,
    effectiveAt: isoDateTimeSchema,
  })
  .strict();

export const jewelryCashSaleSchema = z.object({
  invoiceId: uuidSchema,
  invoiceNumber: z.number().int().positive(),
  payableRial: z.string().regex(/^\d+$/u),
  ledgerTransactionId: uuidSchema,
  inventoryMovementId: uuidSchema,
});

export type CreateJewelryCashSaleInput = z.infer<typeof createJewelryCashSaleSchema>;
export type JewelryCashSale = z.infer<typeof jewelryCashSaleSchema>;
