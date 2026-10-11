/**
 * جداسازی دوجهته برای متنی که داخل **یک رشته‌ی ساده** چسبانده می‌شود — FE-083.
 *
 * در JSX مقدار لاتین (کد کالا، شناسه، موبایل) را با `<bdi>` یا `dir="ltr"`
 * جدا می‌کنیم. ولی جاهایی که عنصر HTML ممکن نیست — متن `<option>`، متن
 * اشتراک‌گذاری رسید که به واتس‌اپ و پیامک می‌رود — الگوریتم bidi ممکن است
 * کد یا شناسه را با علائم و ارقام اطرافش جابه‌جا کند. نویسه‌های نامرئی
 * FSI (U+2068) و PDI (U+2069) همان کار `<bdi>` را در متن ساده می‌کنند.
 *
 * فقط وقتی لازم است اعمال می‌شود: متن تمام‌فارسی بدون رقم لاتین دست نمی‌خورد،
 * تا نویسه‌ی نامرئی بی‌دلیل وارد متن نشود.
 */

const FIRST_STRONG_ISOLATE = String.fromCodePoint(0x2068);
const POP_DIRECTIONAL_ISOLATE = String.fromCodePoint(0x2069);
const NEEDS_ISOLATION = /[A-Za-z0-9]/u;

export function isolateBidi(text: string): string {
  if (!NEEDS_ISOLATION.test(text)) return text;
  return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}
