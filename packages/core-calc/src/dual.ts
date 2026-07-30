/**
 * مبلغ دومقیاسه — قلب گزاره‌ی ارزش محصول.
 *
 * واحد پایه‌ی حسابداری در این صنف **طلا** است، نه ریال. هر مبلغی که روی
 * صفحه می‌آید باید هم‌زمان هر دو چهره را داشته باشد تا کلید تعویض واحد
 * بدون هیچ محاسبه‌ای در لایه‌ی UI کار کند.
 *
 * **`rate1000` مظنه‌ی قفل‌شده در لحظه‌ی رویداد است** (قاعده‌ی ۲-۸ CLAUDE.md).
 * هر سند نرخ خودش را با خود حمل می‌کند؛ گزارش دیروز فردا عوض نمی‌شود.
 * به همین دلیل نرخ *داخل* خود مبلغ نشسته، نه در یک context سراسری.
 *
 * مقادیر اینجا **علامت‌دار** هستند: مانده‌ی بدهکار، زیان و سطر اصلاحیه
 * همگی منفی‌اند. این با وزن فیزیکی کالا (که هرگز منفی نیست) فرق دارد.
 */

import { mulDivHalfUp } from './rounding.js';

/** میلی‌گرم در هر گرم. */
const MG_PER_GRAM = 1000n;

export interface DualAmount {
  /** مبلغ به ریال — علامت‌دار. */
  readonly rial: bigint;
  /** معادل طلای خالص ۱۰۰۰ به میلی‌گرم — علامت‌دار. */
  readonly pureMg: bigint;
  /** نرخ گرم طلای ۱۰۰۰ در لحظه‌ی رویداد. تغییر قیمت امروز این را عوض نمی‌کند. */
  readonly rate1000: bigint;
}

/** ساخت مبلغ دومقیاسه از مقدار ریالی، با نرخ قفل‌شده. */
export function dualFromRial(rialAmount: bigint, rate1000: bigint): DualAmount {
  return {
    rial: rialAmount,
    pureMg: mulDivHalfUp(rialAmount, MG_PER_GRAM, rate1000),
    rate1000,
  };
}

/** ساخت مبلغ دومقیاسه از وزن طلا، با نرخ قفل‌شده. */
export function dualFromPure(pureMgAmount: bigint, rate1000: bigint): DualAmount {
  return {
    rial: mulDivHalfUp(pureMgAmount, rate1000, MG_PER_GRAM),
    pureMg: pureMgAmount,
    rate1000,
  };
}

/** قرینه — برای نمایش طرف مقابل یک سطر دفتر. */
export function negateDual(amount: DualAmount): DualAmount {
  return {
    rial: -amount.rial,
    pureMg: -amount.pureMg,
    rate1000: amount.rate1000,
  };
}

/**
 * جمع دو مبلغ.
 *
 * فقط وقتی معنا دارد که هر دو با یک نرخ قفل شده باشند. جمع‌کردن دو سند
 * با دو مظنه‌ی متفاوت یعنی یکی از دو مقیاس غلط درمی‌آید، پس خطا می‌دهیم
 * به‌جای اینکه بی‌صدا عدد اشتباه بسازیم.
 */
export function addDual(a: DualAmount, b: DualAmount): DualAmount {
  if (a.rate1000 !== b.rate1000) {
    throw new Error('جمع دو مبلغ با نرخ قفل‌شده‌ی متفاوت مجاز نیست');
  }
  return {
    rial: a.rial + b.rial,
    pureMg: a.pureMg + b.pureMg,
    rate1000: a.rate1000,
  };
}

/** صفر با نرخ داده‌شده — حالت خالی کارت‌ها. */
export function zeroDual(rate1000: bigint): DualAmount {
  return { rial: 0n, pureMg: 0n, rate1000 };
}
