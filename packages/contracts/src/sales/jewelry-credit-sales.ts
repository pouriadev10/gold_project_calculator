import { z } from 'zod';
import { isoDateTimeSchema, nonNegativeBigIntStringSchema, uuidSchema } from '../common/index.js';
import { invoicePeriodSchema } from './invoice-period.js';

export const createJewelryCreditSaleSchema = z.object({
  partyId: uuidSchema,
  jewelryItemId: uuidSchema,
  quoteId: uuidSchema,
  effectiveAt: isoDateTimeSchema,
  paidRial: nonNegativeBigIntStringSchema.default('0'),
}).strict();

export const jewelryCreditSaleSchema = z.object({
  invoiceId: uuidSchema,
  invoiceNumber: z.number().int().positive(),
  invoicePeriod: invoicePeriodSchema,
  payableRial: nonNegativeBigIntStringSchema,
  receivableRial: nonNegativeBigIntStringSchema,
  ledgerTransactionId: uuidSchema,
  inventoryMovementId: uuidSchema,
});

export type CreateJewelryCreditSaleInput = z.infer<typeof createJewelryCreditSaleSchema>;
export type JewelryCreditSale = z.infer<typeof jewelryCreditSaleSchema>;
