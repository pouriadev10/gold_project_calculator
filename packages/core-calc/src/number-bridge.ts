/**
 * تنها نقطه‌ی مجاز تبدیل `bigint` به `number` در کل کدبیس.
 *
 * قاعده‌ی ESLint فراخوانی `Number()` را همه‌جا خطا می‌دهد جز همین فایل —
 * دقیقاً همان الگویی که برای گرد کردن در `rounding.ts` استفاده شده.
 *
 * چرا اصلاً لازم است: بعضی APIهای مرورگر (`Intl.RelativeTimeFormat`،
 * `Intl.NumberFormat` در حالت‌هایی) فقط `number` می‌پذیرند. تبدیل بی‌محافظ
 * روی مبلغ ریالی یک مغازه‌ی طلا به‌راحتی دقت را از دست می‌دهد و کسی هم
 * متوجه نمی‌شود — چون خطا نمی‌دهد، فقط عدد را بی‌صدا عوض می‌کند.
 */

import { CalcError } from './types.js';

/** بزرگ‌ترین صحیحی که `number` می‌تواند بدون افت دقت نگه دارد. */
export const MAX_SAFE_BIGINT = 9_007_199_254_740_991n;

/**
 * `bigint` → `number`، با محافظ دقت.
 *
 * اگر مقدار از محدوده‌ی امن بیرون باشد **خطا می‌دهد**، نه اینکه بی‌صدا
 * عددی نادرست برگرداند. هر جا این خطا دیده شد یعنی جایی از منطق دارد
 * مبلغ را از مسیر `bigint` خارج می‌کند — همان‌جا باید اصلاح شود.
 */
export function toSafeNumber(value: bigint): number {
  if (value > MAX_SAFE_BIGINT || value < -MAX_SAFE_BIGINT) {
    throw new CalcError(
      `تبدیل ${value} به number دقت را از دست می‌دهد — مقدار باید bigint بماند`,
    );
  }
  return Number(value);
}

/** آیا این مقدار بدون افت دقت به `number` تبدیل می‌شود؟ */
export function isSafeNumber(value: bigint): boolean {
  return value <= MAX_SAFE_BIGINT && value >= -MAX_SAFE_BIGINT;
}
