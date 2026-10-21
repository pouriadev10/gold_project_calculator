import { z } from 'zod';
import { MAX_PAGE_SIZE, positiveBigIntStringSchema, uuidSchema } from '../common/index.js';

/** The market rate used by phase 1 pricing. More types may be added explicitly later. */
export const priceQuoteTypeSchema = z.enum(['MAZNEH']);

/** The source is server-owned; callers of the manual endpoint cannot set it. */
export const priceQuoteSourceSchema = z.enum(['MANUAL', 'FEED']);

/**
 * A positive rial amount that can be stored exactly by the database bigint
 * column. The bigint bound now lives in `bigIntStringSchema` itself, for every
 * money and weight field, not only this one.
 */
export const priceQuoteAmountRialSchema = positiveBigIntStringSchema;

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

/**
 * `GET /pricing/quotes` — تاریخچه، تازه‌ترین اول. پیش‌تر کل تاریخچه‌ی مستأجر را بی‌سقف برمی‌گرداند،
 * که با چند مظنه در روز (یا یک فید) پس از چند ماه هزاران ردیف می‌شد (M-13). پیش‌فرض و سقف همان
 * `MAX_PAGE_SIZE` است؛ پاسخ همچنان یک آرایه است.
 */
export const priceQuoteHistoryQuerySchema = priceQuoteQuerySchema
  .extend({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(MAX_PAGE_SIZE),
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
export type PriceQuoteHistoryQuery = z.infer<typeof priceQuoteHistoryQuerySchema>;
export type PriceQuote = z.infer<typeof priceQuoteSchema>;
export type PriceQuoteType = z.infer<typeof priceQuoteTypeSchema>;
