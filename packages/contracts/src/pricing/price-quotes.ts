import { z } from 'zod';
import { positiveBigIntStringSchema, uuidSchema } from '../common/index.js';

/** The market rate used by phase 1 pricing. More types may be added explicitly later. */
export const priceQuoteTypeSchema = z.enum(['MAZNEH']);

/** The source is server-owned; callers of the manual endpoint cannot set it. */
export const priceQuoteSourceSchema = z.enum(['MANUAL', 'FEED']);

/** PostgreSQL bigint's upper limit, expressed as an integer rather than a JS number. */
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

/** A positive rial amount that can be stored exactly by the database bigint column. */
export const priceQuoteAmountRialSchema = positiveBigIntStringSchema.pipe(
  z.string().refine(
    (value) => BigInt(value) <= POSTGRES_BIGINT_MAX,
    'مبلغ از بیشینه‌ی قابل ذخیره‌سازی بیشتر است',
  ),
);

/** Input for `POST /pricing/quotes/manual`. Monetary input is always an integer string. */
export const createManualPriceQuoteSchema = z
  .object({
    quoteType: priceQuoteTypeSchema,
    amountRial: priceQuoteAmountRialSchema,
  })
  .strict();

/** Optional filter shared by quote history and latest-quote endpoints. */
export const priceQuoteQuerySchema = z
  .object({
    quoteType: priceQuoteTypeSchema.optional(),
  })
  .strict();

/** JSON representation of an immutable price quote. */
export const priceQuoteSchema = z.object({
  id: uuidSchema,
  quoteType: priceQuoteTypeSchema,
  amountRial: priceQuoteAmountRialSchema,
  source: priceQuoteSourceSchema,
  observedAt: z.string().datetime({ offset: true }),
  createdBy: uuidSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
});

export type CreateManualPriceQuoteInput = z.infer<typeof createManualPriceQuoteSchema>;
export type PriceQuoteQuery = z.infer<typeof priceQuoteQuerySchema>;
export type PriceQuote = z.infer<typeof priceQuoteSchema>;
export type PriceQuoteType = z.infer<typeof priceQuoteTypeSchema>;
