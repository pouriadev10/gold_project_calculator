import { z } from 'zod';
import {
  bigIntStringSchema,
  paginatedSchema,
  paginationQuerySchema,
  uuidSchema,
} from '../common/index.js';
import { partyStatusSchema, partyTypeSchema } from '../parties/parties.js';

export const reportingDisplayUnitSchema = z.enum(['GOLD', 'RIAL']);
export const reportingSortDirectionSchema = z.enum(['ASC', 'DESC']);
export const partyReportDirectionSchema = z.enum(['DEBTOR', 'CREDITOR']);

/**
 * A reference mazneh is required: it converts only the gold/rial presentation
 * and sorting basis. Coin positions are intentionally outside that conversion.
 */
export const partyBalanceReportQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().trim().min(1).max(200).optional(),
    displayUnit: reportingDisplayUnitSchema.default('GOLD'),
    referenceQuoteId: uuidSchema,
    sortDirection: reportingSortDirectionSchema.default('DESC'),
  })
  .strict();

const partyReportCoinBalanceSchema = z.object({
  coinTypeId: uuidSchema,
  code: z.string().min(1),
  count: z.number().int(),
});

const partyReportRawBalancesSchema = z.object({
  rial: bigIntStringSchema,
  pureGoldMg: bigIntStringSchema,
  coins: z.array(partyReportCoinBalanceSchema),
});

const partyReportPartySchema = z.object({
  id: uuidSchema,
  displayName: z.string(),
  type: partyTypeSchema,
  status: partyStatusSchema,
  mobile: z.string().nullable(),
});

const partyReportItemSchema = z.object({
  party: partyReportPartySchema,
  rawBalances: partyReportRawBalancesSchema,
  /** Signed balance in the selected presentation unit; raw dimensions remain authoritative. */
  displayBalance: bigIntStringSchema,
  convertibleDirection: z.enum(['DEBTOR', 'CREDITOR', 'SETTLED']),
  /** A party may be present due to a directional coin position even when convertible balance is settled. */
  coinsRemainSeparate: z.literal(true),
});

const partyReportReferenceMaznehSchema = z.object({
  id: uuidSchema,
  amountRial: bigIntStringSchema,
  observedAt: z.string().datetime({ offset: true }),
  goldRatePerGramRial: bigIntStringSchema,
});

export const partyBalanceReportSchema = paginatedSchema(partyReportItemSchema).extend({
  direction: partyReportDirectionSchema,
  displayUnit: reportingDisplayUnitSchema,
  referenceMazneh: partyReportReferenceMaznehSchema,
});

export type ReportingDisplayUnit = z.infer<typeof reportingDisplayUnitSchema>;
export type PartyReportDirection = z.infer<typeof partyReportDirectionSchema>;
export type PartyBalanceReportQuery = z.infer<typeof partyBalanceReportQuerySchema>;
export type PartyBalanceReport = z.infer<typeof partyBalanceReportSchema>;
