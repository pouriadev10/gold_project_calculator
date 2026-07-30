/**
 * قالب‌بندی نمایشی.
 *
 * قاعده‌ی ۹ BOOTSTRAP: نمایش با `Intl.NumberFormat('fa-IR')`، ولی
 * **مقدار ذخیره‌شده همیشه لاتین و صحیح** است. این فایل تنها مرز میان
 * `bigint` داخلی و رشته‌ی فارسی روی صفحه است.
 *
 * تعداد ارقام اعشار **ثابت** است، نه کوتاه‌شده. ستون ارقام در جدول باید
 * هم‌عرض بماند وگرنه با Tabular Numbers هم می‌لرزد.
 */

import { toPersianDigits } from './persian.js';

/** جداکننده‌ی اعشار فارسی (U+066B) */
const DECIMAL_SEPARATOR = String.fromCodePoint(0x066b);

/** علامت منفی ریاضی (U+2212) — از خط تیره‌ی ASCII خواناتر است */
const MINUS_SIGN = String.fromCodePoint(0x2212);

/** میلی‌گرم در هر گرم — ۳ رقم اعشار گرم */
export const GRAM_DECIMALS = 3;

/** مقیاس مثقال — ۴ رقم اعشار */
export const MESGHAL_DECIMALS = 4;

const INT_FORMAT = new Intl.NumberFormat('fa-IR', {
  useGrouping: true,
  maximumFractionDigits: 0,
});

/**
 * یک `bigint` مقیاس‌شده را به رشته‌ی فارسی تبدیل می‌کند.
 *
 * `value` عدد صحیح در مقیاس ۱۰^decimals است. هیچ شناوری در مسیر نیست:
 * بخش صحیح و بخش اعشار با تقسیم و باقی‌مانده‌ی صحیح جدا می‌شوند.
 */
export function formatScaled(value: bigint, decimals: number): string {
  const isNegative = value < 0n;
  const magnitude = isNegative ? -value : value;
  const unit = 10n ** BigInt(decimals);

  const integerPart = magnitude / unit;
  const fractionPart = magnitude % unit;

  let text = INT_FORMAT.format(integerPart);

  if (decimals > 0) {
    // (frac + unit) صفرِ پیشوند را تضمین می‌کند؛ slice(1) رقم اضافه را برمی‌دارد
    const padded = (fractionPart + unit).toString().slice(1);
    text += DECIMAL_SEPARATOR + toPersianDigits(padded);
  }

  return isNegative ? MINUS_SIGN + text : text;
}

/** ریال — عدد صحیح، بدون اعشار، با گروه‌بندی سه‌رقمی. */
export function formatRial(value: bigint): string {
  return formatScaled(value, 0);
}

/** وزن بر حسب میلی‌گرم → گرم با سه رقم اعشار. */
export function formatGram(mg: bigint): string {
  return formatScaled(mg, GRAM_DECIMALS);
}

/** مثقال در مقیاس ۱۰⁴ → مثقال با چهار رقم اعشار. */
export function formatMesghal(mesghalX1e4: bigint): string {
  return formatScaled(mesghalX1e4, MESGHAL_DECIMALS);
}

/** تعداد سکه — عدد صحیح شمارشی. */
export function formatCoinCount(count: number): string {
  return INT_FORMAT.format(BigInt(count));
}

/** عیار — همیشه سه‌رقمی و بدون گروه‌بندی: ۷۵۰، ۹۹۵، ۹۲۵. */
export function formatKarat(k: number): string {
  return toPersianDigits(String(k));
}
