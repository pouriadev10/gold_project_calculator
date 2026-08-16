import { gramRate, gramRate1000, karat } from '@gold/core-calc';
import { useLatestPriceQuote } from '@/api/queries';
import type { PriceQuote } from '@/api/contracts';

/**
 * مظنه‌ی جاری برای نوار بالای صفحه — FE-029.
 *
 * داده از `GET /pricing/quotes/latest` می‌آید (BE-021): فقط رکورد خام
 * مظنه، نه نرخ هر عیار. نرخ گرم ۷۵۰/۱۰۰۰ همین‌جا با `gramRate` از
 * `core-calc` محاسبه می‌شود — این تبدیل ثابت ریاضی است (بخش ۳ CLAUDE.md)
 * و نیازی به رفت‌وبرگشت با سرور ندارد.
 *
 * پاسخ سرور می‌تواند `null` باشد (هیچ مظنه‌ای هنوز ثبت نشده) — این حالت
 * «خالی» است، نه خطا؛ از حالت بارگذاری/خطای واقعی جدا نگه داشته می‌شود.
 */

const DISPLAY_KARAT = karat(750);

/**
 * آستانه‌ی «قدیمی» — فقط برای نشان‌دادن هشدار، نه یک قاعده‌ی حسابداری.
 * تبدیل به تنظیم قابل‌تغییر هر مستأجر (قاعده‌ی ۲-۶ CLAUDE.md) در صورت
 * نیاز، کار فازهای بعد است — این عدد هیچ مبلغ فاکتور را تغییر نمی‌دهد،
 * فقط یک نشان بصری است.
 */
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

export interface MaznehSnapshot {
  readonly mazneh: bigint;
  readonly gram750: bigint;
  readonly gram1000: bigint;
  readonly source: PriceQuote['source'];
  readonly observedAt: Date;
  readonly isStale: boolean;
}

function toSnapshot(quote: PriceQuote | null | undefined): MaznehSnapshot | null | undefined {
  if (quote === undefined || quote === null) return quote;

  const observedAt = new Date(quote.observedAt);
  return {
    mazneh: quote.amountRial,
    gram750: gramRate(quote.amountRial, DISPLAY_KARAT),
    gram1000: gramRate1000(quote.amountRial),
    source: quote.source,
    observedAt,
    isStale: Date.now() - observedAt.getTime() > STALE_THRESHOLD_MS,
  };
}

export function useMazneh() {
  const query = useLatestPriceQuote('MAZNEH');

  return {
    ...query,
    data: toSnapshot(query.data),
    /** موفق ولی بدون هیچ مظنه‌ی ثبت‌شده — نه بارگذاری، نه خطا. */
    isEmpty: query.isSuccess && query.data === null,
  };
}
