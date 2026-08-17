import { z } from 'zod';
import { isoDateTimeSchema, nonNegativeBigIntStringSchema, uuidSchema } from '../common/index.js';

const invoiceHistoryActorSchema = z.object({
  id: uuidSchema,
  displayName: z.string(),
});

const invoiceHistoryItemSchema = z.object({
  itemType: z.enum(['JEWELRY', 'COIN']),
  itemId: uuidSchema,
  quantity: nonNegativeBigIntStringSchema,
  pureWeightMg: nonNegativeBigIntStringSchema.nullable(),
  karat: z.number().int().min(1).max(1000).nullable(),
});

const invoiceHistoryLedgerEntrySchema = z.object({
  accountId: uuidSchema,
  dimensionId: uuidSchema,
  quantity: z.string().regex(/^-?\d+$/u),
});

const invoiceHistoryLedgerEffectSchema = z.object({
  transactionId: uuidSchema,
  effectiveAt: isoDateTimeSchema,
  entries: z.array(invoiceHistoryLedgerEntrySchema),
});

const invoiceHistoryInventoryEffectSchema = z.object({
  movementId: uuidSchema,
  itemType: z.enum(['JEWELRY', 'MELTED_GOLD', 'COIN']),
  itemId: uuidSchema.nullable(),
  dimensionId: uuidSchema,
  quantity: z.string().regex(/^-?\d+$/u),
  occurredAt: isoDateTimeSchema,
});

export const salesInvoiceVersionHistorySchema = z.object({
  invoiceId: uuidSchema,
  invoiceNumber: z.number().int().positive(),
  versions: z.array(
    z.object({
      version: z.number().int().positive(),
      reason: z.string().nullable(),
      reasonDetail: z.string().nullable(),
      partyId: uuidSchema,
      actor: invoiceHistoryActorSchema.nullable(),
      createdAt: isoDateTimeSchema,
      payableRial: nonNegativeBigIntStringSchema.nullable(),
      pureWeightMg: nonNegativeBigIntStringSchema.nullable(),
      karat: z.number().int().min(1).max(1000).nullable(),
      items: z.array(invoiceHistoryItemSchema),
      totalsSnapshot: z.unknown(),
      settingsSnapshot: z.unknown(),
      ledgerEffects: z.array(invoiceHistoryLedgerEffectSchema),
      inventoryEffects: z.array(invoiceHistoryInventoryEffectSchema),
    }),
  ),
});

export const salesInvoiceAmendmentHistorySchema = z.object({
  invoiceId: uuidSchema,
  invoiceNumber: z.number().int().positive(),
  amendments: z.array(
    z.object({
      version: z.number().int().min(2),
      reason: z.string(),
      reasonDetail: z.string().nullable(),
      actor: invoiceHistoryActorSchema.nullable(),
      createdAt: isoDateTimeSchema,
      changes: z.object({
        pureWeightMg: z.object({
          before: nonNegativeBigIntStringSchema.nullable(),
          after: nonNegativeBigIntStringSchema.nullable(),
          delta: z
            .string()
            .regex(/^-?\d+$/u)
            .nullable(),
        }),
        payableRial: z.object({
          before: nonNegativeBigIntStringSchema.nullable(),
          after: nonNegativeBigIntStringSchema.nullable(),
          delta: z
            .string()
            .regex(/^-?\d+$/u)
            .nullable(),
        }),
        karat: z.object({
          before: z.number().int().nullable(),
          after: z.number().int().nullable(),
        }),
      }),
      ledgerEffects: z.array(invoiceHistoryLedgerEffectSchema),
      inventoryEffects: z.array(invoiceHistoryInventoryEffectSchema),
    }),
  ),
});

export type SalesInvoiceVersionHistory = z.infer<typeof salesInvoiceVersionHistorySchema>;
export type SalesInvoiceAmendmentHistory = z.infer<typeof salesInvoiceAmendmentHistorySchema>;
