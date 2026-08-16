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

/** The dashboard always uses the latest tenant mazneh; only presentation unit is selectable. */
export const dashboardQuerySchema = z
  .object({ displayUnit: reportingDisplayUnitSchema.default('GOLD') })
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

const dashboardRawAmountSchema = z.object({
  rial: bigIntStringSchema,
  pureGoldMg: bigIntStringSchema,
});

const dashboardFinancialCardSchema = z.object({
  /** Raw dimensions are never collapsed or persisted as a converted amount. */
  raw: dashboardRawAmountSchema,
  /** Null only while the tenant has no current mazneh for cross-unit display. */
  displayAmount: bigIntStringSchema.nullable(),
});

const dashboardInventoryCoinSchema = z.object({
  coinTypeId: uuidSchema,
  code: z.string().min(1),
  count: z.number().int(),
});

export const dashboardSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  dayStartsAt: z.string().datetime({ offset: true }),
  dayEndsAt: z.string().datetime({ offset: true }),
  displayUnit: reportingDisplayUnitSchema,
  currentMazneh: partyReportReferenceMaznehSchema.nullable(),
  today: z.object({
    sales: dashboardFinancialCardSchema,
    purchases: dashboardFinancialCardSchema,
    receipts: dashboardFinancialCardSchema,
    payments: dashboardFinancialCardSchema,
    invoiceCount: z.number().int().nonnegative(),
  }),
  /** Null until a mazneh exists, because netting rial and gold would otherwise be invalid. */
  partyBalances: z
    .object({
      debtors: dashboardFinancialCardSchema,
      creditors: dashboardFinancialCardSchema,
      coinsRemainSeparate: z.literal(true),
    })
    .nullable(),
  inventory: z.object({
    meltedGoldPureMg: bigIntStringSchema,
    coins: z.array(dashboardInventoryCoinSchema),
  }),
});

export type ReportingDisplayUnit = z.infer<typeof reportingDisplayUnitSchema>;
export type PartyReportDirection = z.infer<typeof partyReportDirectionSchema>;
export type PartyBalanceReportQuery = z.infer<typeof partyBalanceReportQuerySchema>;
export type PartyBalanceReport = z.infer<typeof partyBalanceReportSchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
