import { apiPost } from './client';
import {
  priceFeedRefreshResultSchema,
  priceQuoteSchema,
  type CreateManualPriceQuoteInput,
  type PriceFeedRefreshResult,
  type PriceQuote,
} from './contracts';

/**
 * ثبت مظنه‌ی دستی — `POST /pricing/quotes/manual` (BE-021).
 *
 * تابع مجزا از `queries.ts` است، به همان دلیل `api/auth.ts`: این یک
 * نوشتن یک‌بارمصرف است که `ManualQuoteForm` مستقیماً با `useIdempotentSubmit`
 * می‌پوشاند، نه با `useMutation`.
 *
 * `quoteType` همیشه `'MAZNEH'` است — تنها عضو `priceQuoteTypeSchema` در
 * فاز ۱؛ فرم چیزی برای انتخاب ندارد، پس اینجا صراحتاً ثابت است، نه یک
 * مقدار پیش‌فرض قابل‌تغییر.
 */
export function createManualPriceQuote(
  amountRial: bigint,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PriceQuote> {
  const body: CreateManualPriceQuoteInput = {
    quoteType: 'MAZNEH',
    amountRial: amountRial.toString(),
  };
  return apiPost('/pricing/quotes/manual', body, priceQuoteSchema, idempotencyKey, signal);
}

/**
 * تلاش دستی برای دریافت مظنه از فید — `POST /pricing/feed/refresh` (FE-082).
 * فقط OWNER و MANAGER. شکست فید خطای HTTP نیست: نتیجه `FALLBACK` (آخرین
 * مظنه‌ی ذخیره‌شده همچنان معتبر) یا `UNAVAILABLE` (هیچ مظنه‌ای نیست) است.
 */
export function refreshPriceFeed(idempotencyKey: string, signal?: AbortSignal): Promise<PriceFeedRefreshResult> {
  return apiPost(
    '/pricing/feed/refresh',
    { quoteType: 'MAZNEH' },
    priceFeedRefreshResultSchema,
    idempotencyKey,
    signal,
  );
}
