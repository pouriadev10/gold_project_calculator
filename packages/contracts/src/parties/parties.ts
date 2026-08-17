import { z } from 'zod';
import {
  bigIntStringSchema,
  isoDateTimeSchema,
  paginatedSchema,
  paginationQuerySchema,
  uuidSchema,
} from '../common/index.js';

/** Classifications supported for phase-1 counterparties. */
export const partyTypeSchema = z.enum(['CONSUMER', 'BUSINESS']);

/** A party is retained for history and can only be made unavailable, not deleted. */
export const partyStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

const displayNameSchema = z.string().trim().min(1).max(200);
const mobileSchema = z.string().trim().min(1).max(32);
const nationalIdSchema = z.string().trim().min(1).max(32);
const notesSchema = z.string().trim().max(2_000);

/** Input for `POST /parties`. Server-side normalization owns derived search fields. */
export const createPartySchema = z
  .object({
    type: partyTypeSchema,
    displayName: displayNameSchema,
    mobile: mobileSchema.optional(),
    nationalId: nationalIdSchema.optional(),
    linkedTenantId: uuidSchema.optional(),
    notes: notesSchema.optional(),
  })
  .strict();

/** Input for `PATCH /parties/:id`; null clears an optional identifying field. */
export const updatePartySchema = z
  .object({
    type: partyTypeSchema.optional(),
    displayName: displayNameSchema.optional(),
    mobile: mobileSchema.nullable().optional(),
    nationalId: nationalIdSchema.nullable().optional(),
    linkedTenantId: uuidSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'حداقل یک فیلد برای ویرایش لازم است');

/** Search, status/type filters, and offset pagination for `GET /parties`. */
export const partyListQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().trim().min(1).max(200).optional(),
    type: partyTypeSchema.optional(),
    status: partyStatusSchema.optional(),
  })
  .strict();

/** JSON representation of a tenant-scoped counterparty. */
export const partySchema = z.object({
  id: uuidSchema,
  type: partyTypeSchema,
  displayName: z.string(),
  mobile: z.string().nullable(),
  nationalId: z.string().nullable(),
  linkedTenantId: uuidSchema.nullable(),
  status: partyStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const partyListSchema = paginatedSchema(partySchema);

/** Optional historical cut-off and mazneh used only for the separate display projection. */
export const partyBalancesQuerySchema = z
  .object({
    at: isoDateTimeSchema.optional(),
    referenceQuoteId: uuidSchema.optional(),
  })
  .strict();

const partyCoinBalanceSchema = z.object({
  coinTypeId: uuidSchema,
  code: z.string().min(1),
  count: z.number().int(),
});

const partyRawBalancesSchema = z.object({
  rial: bigIntStringSchema,
  pureGoldMg: bigIntStringSchema,
  coins: z.array(partyCoinBalanceSchema),
});

const partyGoldDisplaySchema = z.object({
  displayUnit: z.literal('GOLD'),
  referenceMazneh: z.object({
    id: uuidSchema,
    amountRial: bigIntStringSchema,
    observedAt: isoDateTimeSchema,
    goldRatePerGramRial: bigIntStringSchema,
  }),
  rialEquivalentPureGoldMg: bigIntStringSchema,
  totalGoldDisplayPureMg: bigIntStringSchema,
  /** Coin positions intentionally stay in `rawBalances.coins`; mazneh alone cannot price their bubble. */
  coinsRemainSeparate: z.literal(true),
});

/**
 * Party subledger balance. `rawBalances` is the accounting truth; `convertedView`
 * is optional presentation data and never changes or collapses a raw dimension.
 */
export const partyBalancesSchema = z.object({
  partyId: uuidSchema,
  calculatedAt: isoDateTimeSchema,
  defaultDisplayUnit: z.literal('GOLD'),
  rawBalances: partyRawBalancesSchema,
  convertedView: partyGoldDisplaySchema.nullable(),
});

export const partyStatementSourceTypeSchema = z.enum([
  'OPENING_BALANCE',
  'SALES_INVOICE',
  'SECOND_HAND_PURCHASE',
  'SETTLEMENT',
  'SALES_INVOICE_AMENDMENT',
  'LEDGER_REVERSAL',
]);

/** Date filters apply to `ledger_transactions.effective_at`, never record insertion time. */
export const partyStatementQuerySchema = paginationQuerySchema
  .extend({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    dimensionId: uuidSchema.optional(),
    sourceType: partyStatementSourceTypeSchema.optional(),
    /** A display-only mazneh. It never replaces a source document's locked snapshot. */
    referenceQuoteId: uuidSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.from !== undefined &&
      value.to !== undefined &&
      new Date(value.from).getTime() > new Date(value.to).getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'End of statement range must not be before its start',
      });
    }
  });

const partyStatementRateSnapshotSchema = z.object({
  quoteId: uuidSchema.nullable(),
  quoteAmountRial: bigIntStringSchema.nullable(),
  quoteObservedAt: isoDateTimeSchema.nullable(),
  /** Immutable source-document snapshot; this is never recalculated with a display rate. */
  pricingSnapshot: z.unknown().nullable(),
});

const partyStatementDimensionSchema = z.object({
  id: uuidSchema,
  code: z.string().min(1),
  kind: z.enum(['RIAL', 'GOLD', 'SILVER', 'COIN']),
  coinTypeId: uuidSchema.nullable(),
  coinCode: z.string().min(1).nullable(),
});

const partyStatementEntrySchema = z.object({
  ledgerTransactionId: uuidSchema,
  source: z.object({
    type: partyStatementSourceTypeSchema,
    id: uuidSchema,
  }),
  effectiveAt: isoDateTimeSchema,
  description: z.string(),
  dimension: partyStatementDimensionSchema,
  quantity: bigIntStringSchema,
  runningBalance: bigIntStringSchema,
  documentRateSnapshots: z.array(partyStatementRateSnapshotSchema),
});

const partyStatementDisplayReferenceMaznehSchema = z.object({
  id: uuidSchema,
  amountRial: bigIntStringSchema,
  observedAt: isoDateTimeSchema,
});

/**
 * Paginated party subledger rows. Running balances are calculated across the
 * complete party ledger before statement filters and pagination are applied.
 */
export const partyStatementSchema = paginatedSchema(partyStatementEntrySchema).extend({
  partyId: uuidSchema,
  displayReferenceMazneh: partyStatementDisplayReferenceMaznehSchema.nullable(),
});

export type CreatePartyInput = z.infer<typeof createPartySchema>;
export type UpdatePartyInput = z.infer<typeof updatePartySchema>;
export type PartyListQuery = z.infer<typeof partyListQuerySchema>;
export type Party = z.infer<typeof partySchema>;
export type PartyList = z.infer<typeof partyListSchema>;
export type PartyBalancesQuery = z.infer<typeof partyBalancesQuerySchema>;
export type PartyBalances = z.infer<typeof partyBalancesSchema>;
export type PartyStatementSourceType = z.infer<typeof partyStatementSourceTypeSchema>;
export type PartyStatementQuery = z.infer<typeof partyStatementQuerySchema>;
export type PartyStatement = z.infer<typeof partyStatementSchema>;
