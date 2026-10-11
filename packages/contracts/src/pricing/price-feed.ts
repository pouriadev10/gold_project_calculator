import { z } from 'zod';
import { isoDateTimeSchema } from '../common/index.js';
import { priceQuoteSchema, priceQuoteTypeSchema } from './price-quotes.js';

/**
 * وضعیت منبع مظنه — FE-082.
 *
 * «منبع فعال» یعنی منبع آخرین مظنه‌ی ذخیره‌شده (`activeQuote`)، چون فروش و
 * خرید همیشه با شناسه‌ی همین رکورد ذخیره‌شده قیمت می‌خورند (`quoteId`) و
 * هرگز در لحظه‌ی ثبت به فید وصل نمی‌شوند؛ قطع بودن فید هیچ معامله‌ای را
 * متوقف نمی‌کند.
 */
export const priceFeedStatusSchema = z.object({
  quoteType: priceQuoteTypeSchema,
  /** آیا adapter واقعی فید پیکربندی شده است؛ `false` یعنی فقط ورود دستی. */
  providerConfigured: z.boolean(),
  /** آخرین مظنه‌ی ذخیره‌شده از هر منبع — همانی که معامله‌ی تازه با آن قیمت می‌خورد. */
  activeQuote: priceQuoteSchema.nullable(),
  latestFeedQuote: priceQuoteSchema.nullable(),
  latestManualQuote: priceQuoteSchema.nullable(),
  checkedAt: isoDateTimeSchema,
});

/** پارامتر `GET /pricing/feed/status`. */
export const priceFeedStatusQuerySchema = z
  .object({
    quoteType: priceQuoteTypeSchema,
  })
  .strict();

/** ورودی `POST /pricing/feed/refresh`. */
export const refreshPriceFeedSchema = z
  .object({
    quoteType: priceQuoteTypeSchema,
  })
  .strict();

/** چرا فید مظنه‌ی تازه نداد. */
export const priceFeedFailureSchema = z.enum(['NOT_CONFIGURED', 'PROVIDER_ERROR', 'PROVIDER_TIMEOUT']);

/**
 * نتیجه‌ی تلاش دریافت از فید:
 * - `FEED`: مظنه‌ی تازه از فید ذخیره شد.
 * - `FALLBACK`: فید جواب نداد؛ آخرین مظنه‌ی ذخیره‌شده (هر منبعی) همچنان معتبر است.
 * - `UNAVAILABLE`: فید جواب نداد و هیچ مظنه‌ی ذخیره‌شده‌ای هم نیست — باید دستی ثبت شود.
 */
export const priceFeedRefreshResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('FEED'), failure: z.null(), quote: priceQuoteSchema }),
  z.object({ outcome: z.literal('FALLBACK'), failure: priceFeedFailureSchema, quote: priceQuoteSchema }),
  z.object({ outcome: z.literal('UNAVAILABLE'), failure: priceFeedFailureSchema, quote: z.null() }),
]);

export type PriceFeedStatus = z.infer<typeof priceFeedStatusSchema>;
export type PriceFeedStatusQuery = z.infer<typeof priceFeedStatusQuerySchema>;
export type RefreshPriceFeedInput = z.infer<typeof refreshPriceFeedSchema>;
export type PriceFeedFailure = z.infer<typeof priceFeedFailureSchema>;
export type PriceFeedRefreshResult = z.infer<typeof priceFeedRefreshResultSchema>;
