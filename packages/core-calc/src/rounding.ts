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

/**
 * عدد اعشاری **ابزار دقیق** → `bigint` مقیاس‌شده.
 *
 * ⚠️ **فقط برای اندازه‌گیری، هرگز برای پول یا وزن.**
 *
 * بعضی APIهای مرورگر ذاتاً `number` اعشاری می‌دهند (`performance.now`,
 * `IntersectionObserver`) و آن اعداد از اول تقریبی‌اند. تبدیلشان برای
 * نمایش اشکالی ندارد. مبلغ و وزن اما هرگز از این مسیر عبور نمی‌کنند —
 * آن‌ها از ابتدا `bigint`اند و اصلاً `number` نمی‌شوند.
 *
 * اینجا زندگی می‌کند، نه در `number-bridge.ts`، چون گرد کردن است و قاعده‌ی
 * ۲-۱ CLAUDE.md هر گرد کردنی را فقط در همین فایل مجاز می‌داند. سیاستش هم
 * همان نیم‌به‌دور-از-صفر بقیه‌ی این فایل است (`Math.round` تنها رو به +∞
 * می‌برد: −۲٫۵ → −۲).
 */
export function measurementToScaled(value: number, decimals: number): bigint {
  if (!Number.isFinite(value)) {
    throw new CalcError('اندازه‌گیری نامعتبر است');
  }
  const scaled = value * 10 ** decimals;
  return BigInt(Math.sign(scaled) * Math.round(Math.abs(scaled)));
}
