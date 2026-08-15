/**
 * تبدیل عیار و واحد وزن.
 *
 *   وزن خالص = وزن ناخالص × عیار ÷ ۱۰۰۰
 *   مثقال    = ۴.۶۰۸۳ گرم
 *
 * همه‌ی تبدیل‌ها از `mulDivHalfUp` عبور می‌کنند: ضرب پیش از تقسیم،
 * و تنها یک بار گرد کردن — هیچ خطای شناوری انباشته نمی‌شود.
 */

import { mulDivHalfUp } from './rounding.js';
import { KARAT_BASE, grossMg, pureMg } from './types.js';
import type { GrossMg, Karat, PureMg } from './types.js';

const KARAT_BASE_BIG = BigInt(KARAT_BASE);

/** مثقال بر حسب میلی‌گرم، در مقیاس ۱۰ — ۴.۶۰۸۳ گرم = ۴۶۰۸.۳ میلی‌گرم. */
export const MESGHAL_MG_X10 = 46_083n;

/** مقیاس خروجی مثقال: چهار رقم اعشار. */
export const MESGHAL_SCALE = 10_000n;

/** وزن ناخالص → وزن طلای خالص ۱۰۰۰. */
export function toPureMg(gross: GrossMg, k: Karat): PureMg {
  return pureMg(mulDivHalfUp(gross, BigInt(k), KARAT_BASE_BIG));
}

/** وزن طلای خالص ۱۰۰۰ → وزن ناخالص در عیار داده‌شده. */
export function fromPureMg(pure: PureMg, k: Karat): GrossMg {
  return grossMg(mulDivHalfUp(pure, KARAT_BASE_BIG, BigInt(k)));
}

/**
 * همان تبدیل `fromPureMg`، برای مبالغ **علامت‌دار** دفتر کل — نه وزن کالا.
 *
 * `DualAmount.pureMg` می‌تواند منفی باشد (مانده‌ی بدهکار، سطر اصلاحیه)،
 * در حالی که برند `PureMg`/`GrossMg` منفی را رد می‌کند چون وزن فیزیکی
 * کالا هرگز منفی نیست. این تابع فقط برای نمایش «گرم معادل عیار k» یک
 * مبلغ دومقیاسه است — محاسبه‌ی حسابداری نمی‌سازد، همان وزن خالص را در
 * مبنای دیگری بازمی‌نویسد.
 */
export function fromPureMgSigned(pureMgSigned: bigint, k: Karat): bigint {
  return mulDivHalfUp(pureMgSigned, KARAT_BASE_BIG, BigInt(k));
}

/**
 * گام شبکه‌ی نمایش‌پذیر یک عیار بر حسب میلی‌گرم.
 *
 * برای وزن‌های ناخالصی که مضرب این گام باشند، رفت‌وبرگشت
 * `toPureMg → fromPureMg` دقیقاً بدون خطا برمی‌گردد. برای بقیه‌ی
 * وزن‌ها خطا حداکثر ۱ میلی‌گرم است — سقف ذاتی ذخیره‌سازی صحیح.
 */
export function karatLatticeMg(k: Karat): bigint {
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  return KARAT_BASE_BIG / gcd(BigInt(k), KARAT_BASE_BIG);
}

/** میلی‌گرم → مثقال، خروجی در مقیاس ۱۰⁴ (چهار رقم اعشار مثقال). */
export function gramToMesghal(mg: bigint): bigint {
  return mulDivHalfUp(mg, 10n * MESGHAL_SCALE, MESGHAL_MG_X10);
}

/** مثقال در مقیاس ۱۰⁴ → میلی‌گرم. */
export function mesghalToGram(mesghalX1e4: bigint): bigint {
  return mulDivHalfUp(mesghalX1e4, MESGHAL_MG_X10, 10n * MESGHAL_SCALE);
}
