import { z } from 'zod';
import {
  coinCountSchema,
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

/*
 * سطرها هم مثل خود سند `strict`اند (مثل سطرهای تسویه‌ی ترکیبی): کلید ناشناخته‌ی
 * سطر قبلاً بی‌صدا حذف می‌شد، پس فیلدی با نام غلط (مثلاً `payableRial`) بدون
 * هیچ خطایی نادیده می‌ماند.
 */
const amendedJewelryItemSchema = z
  .object({
    itemType: z.literal('JEWELRY'),
    jewelryItemId: uuidSchema,
    paidRial: nonNegativeBigIntStringSchema,
  })
  .strict();

const amendedCoinItemSchema = z
  .object({
    itemType: z.literal('COIN'),
    coinTypeId: uuidSchema,
    count: coinCountSchema,
    marketUnitPriceRial: positiveBigIntStringSchema,
    paidRial: nonNegativeBigIntStringSchema,
  })
  .strict();

/**
 * A correction supplies source facts only. Payable, receivable, pure gold
 * weight, settings, and every ledger amount are recalculated on the server.
 */
export const amendSalesInvoiceSchema = z
  .object({
    reason: invoiceAmendmentReasonSchema,
    reasonDetail: z.string().trim().min(1).max(2_000).optional(),
    partyId: uuidSchema,
    item: z.discriminatedUnion('itemType', [amendedJewelryItemSchema, amendedCoinItemSchema]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reason === 'OTHER' && value.reasonDetail === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonDetail'],
        message: 'برای دلیل «سایر» توضیح لازم است',
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

/**
 * Read-only start check. The final amendment still re-evaluates the policy with
 * its actual reason and calculated payable variance inside the write transaction.
 */
export const invoiceAmendmentPreflightSchema = z.object({
  invoiceId: uuidSchema,
  invoiceVersion: z.number().int().nonnegative(),
  evaluatedAt: z.string().datetime({ offset: true }),
  allowed: z.boolean(),
  requiresManagerAuthorization: z.boolean(),
  restrictions: z.array(
    z.enum([
      'INVOICE_NOT_FINALIZED',
      'UNSUPPORTED_ITEMS',
      'OUTSIDE_CORRECTION_WINDOW',
      'BUSINESS_DAY_CLOSED',
      'SETTLED_INVOICE',
      'VARIANCE_EXCEEDS_MANAGER_THRESHOLD',
    ]),
  ),
});

export type AmendSalesInvoiceInput = z.infer<typeof amendSalesInvoiceSchema>;
export type AmendedSalesInvoice = z.infer<typeof amendedSalesInvoiceSchema>;
export type InvoiceAmendmentPreflight = z.infer<typeof invoiceAmendmentPreflightSchema>;
