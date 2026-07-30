/**
 * تنها خانه‌ی مجاز گرد کردن در کل کدبیس.
 *
 * قاعده‌ی ۳ BOOTSTRAP: هیچ `Math.round` دیگری در پروژه وجود ندارد —
 * قاعده‌ی ESLint این فایل را استثنا کرده و بقیه را خطا می‌دهد.
 *
 * سیاست: `roundHalfUp` = گرد کردن به نزدیک‌ترین، و در حالت دقیقاً نصف
 * دور شدن از صفر (معادل `RoundingMode.HALF_UP` جاوا). این سیاست
 * برای مبالغ منفی (مرجوعی و اصلاحیه) متقارن است.
 */

import { CalcError } from './types.js';

/** واحد پیش‌فرض گرد کردن مبلغ نهایی فاکتور — ۱۰۰۰ ریال. */
export const DEFAULT_ROUNDING_UNIT = 1000n;

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * گرد کردن `value` به نزدیک‌ترین مضرب `unit`، با سیاست نیم‌به‌بالا.
 *
 * فقط در لحظه‌ی نهایی‌شدن مبلغ فراخوانی می‌شود؛ محاسبات میانی گرد نمی‌شوند.
 */
export function roundHalfUp(value: bigint, unit: bigint = DEFAULT_ROUNDING_UNIT): bigint {
  if (unit <= 0n) throw new CalcError('واحد گرد کردن باید مثبت باشد');

  const magnitude = abs(value);
  const remainder = magnitude % unit;
  const floored = magnitude - remainder;
  const rounded = remainder * 2n >= unit ? floored + unit : floored;

  return value < 0n ? -rounded : rounded;
}

/**
 * `(a × b) ÷ c` با یک بار گرد کردن نیم‌به‌بالا در انتها.
 *
 * ضرب پیش از تقسیم انجام می‌شود تا هیچ دقتی در میانه از دست نرود.
 * این تابع پایه‌ی هر تبدیل عیار و نرخ در `core-calc` است.
 */
export function mulDivHalfUp(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new CalcError('تقسیم بر صفر');

  const numerator = a * b;
  const isNegative = numerator < 0n !== c < 0n;
  const magnitude = abs(numerator);
  const divisor = abs(c);

  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;

  return isNegative ? -rounded : rounded;
}
