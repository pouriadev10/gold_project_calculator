import { z } from 'zod';
import {
  nonNegativeBigIntStringSchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';

export const invoiceAmendmentReasonSchema = z.enum([
  'WEIGHT_ERROR',
  'KARAT_ERROR',
  'WAGE_ERROR',
  'PARTY_ERROR',
  'PAYMENT_ERROR',
  'OTHER',
]);

const amendedJewelryItemSchema = z.object({
  itemType: z.literal('JEWELRY'),
  jewelryItemId: uuidSchema,
  paidRial: nonNegativeBigIntStringSchema,
});

const amendedCoinItemSchema = z.object({
  itemType: z.literal('COIN'),
  coinTypeId: uuidSchema,
  count: z.number().int().positive(),
  marketUnitPriceRial: positiveBigIntStringSchema,
  paidRial: nonNegativeBigIntStringSchema,
});

/**
 * A correction supplies source facts only. Payable, receivable, pure gold
 * weight, settings, and every ledger amount are recalculated on the server.
 */
export const amendSalesInvoiceSchema = z
  .object({
    reason: invoiceAmendmentReasonSchema,
    reasonDetail: z.string().trim().min(1).optional(),
    partyId: uuidSchema,
    item: z.discriminatedUnion('itemType', [amendedJewelryItemSchema, amendedCoinItemSchema]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reason === 'OTHER' && value.reasonDetail === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonDetail'],
        message: 'reasonDetail is required when reason is OTHER',
      });
    }
  });

export const amendedSalesInvoiceSchema = z.object({
  invoiceId: uuidSchema,
  invoiceNumber: z.number().int().positive(),
  version: z.number().int().positive(),
  payableRial: nonNegativeBigIntStringSchema,
  receivableRial: nonNegativeBigIntStringSchema,
  ledgerTransactionId: uuidSchema,
  inventoryMovementIds: z.array(uuidSchema),
});

export type AmendSalesInvoiceInput = z.infer<typeof amendSalesInvoiceSchema>;
export type AmendedSalesInvoice = z.infer<typeof amendedSalesInvoiceSchema>;
