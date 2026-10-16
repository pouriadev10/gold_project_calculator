/**
 * نرخ سند — FE-104، قاعده‌ی ۲-۸ CLAUDE.md.
 *
 * چند پاسخ نوشتنی (فروش سکه، تسویه با سکه، تسویه‌ی ترکیبی) نرخ را برنمی‌گردانند؛ سرور سند را
 * با **همان مظنه‌ای** قیمت می‌زند که کلاینت با `quoteId` فرستاده. پس نرخ سند، نرخ همان رکورد
 * مظنه است — و رکورد مظنه تغییرناپذیر است. این تابع آن نرخ را فقط وقتی می‌دهد که مظنه‌ی در
 * دست دقیقاً همان رکورد باشد؛ در غیر این صورت (مظنه وسط تلاش‌های دوباره عوض شده، یا صفحه پس
 * از بازگشت تلاش سنجاق‌شده را تکرار می‌کند) `null` است و مبلغ فقط چهره‌ی ریالی خامش را نشان
 * می‌دهد. هرگز نرخ امروز جای نرخ سند نمی‌نشیند.
 *
 * نتیجه را **در لحظه‌ی ثبت** بگیر و کنار نتیجه نگه دار؛ آن را از مظنه‌ی زنده‌ی هر رندر نساز.
 */
export function documentQuoteRate(
  quoteId: string | null | undefined,
  quote: { readonly quoteId: string; readonly gram1000: bigint } | null | undefined,
): bigint | null {
  if (quoteId === null || quoteId === undefined || quote === null || quote === undefined)
    return null;
  return quote.quoteId === quoteId ? quote.gram1000 : null;
}
