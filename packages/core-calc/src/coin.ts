/**
 * سکه و شمش.
 *
 * ## قانون حباب 🔒
 *
 * **فقط و فقط سکه‌های ضرب بانک مرکزی حباب دارند.**
 * هیچ شمشی در هیچ حالتی حباب ندارد — داخلی یا خارجی، طلا یا نقره،
 * برنددار یا بی‌برند، هر عیاری.
 *
 * این قاعده اینجا با **نوع** اجبار شده، نه با شرط زمان اجرا:
 * `bubble()` فقط `CoinType` می‌پذیرد. پاس دادن `BullionType` خطای
 * زمان کامپایل می‌دهد، نه صفر برمی‌گرداند.
 *
 * سکه یک شیء شمارشی است، نه یک وزن. تبدیل سکه به گرم فقط یک نمای
 * گزارشی است — در لایه‌ی ذخیره‌سازی هرگز اتفاق نمی‌افتد.
 */

import { toPureMg } from './karat.js';
import { valueOfPure } from './pricing.js';
import { coinDimension, rial } from './types.js';
import type { AssetDimension, GrossMg, Karat, Rial } from './types.js';

/**
 * نوع سکه‌ی ضرب بانک مرکزی.
 *
 * مقادیر مشخص (وزن، عیار) عمداً اینجا نیستند — قاعده‌ی ۲-۶ CLAUDE.md:
 * هیچ عدد صنفی در کد هاردکد نمی‌شود. این‌ها رکورد دیتابیسی نسخه‌دار
 * هستند و به‌صورت پارامتر به این توابع می‌رسند.
 */
export interface CoinType {
  readonly kind: 'coin';
  readonly id: string;
  readonly label: string;
  readonly grossMg: GrossMg;
  readonly karat: Karat;
}

/** شمش — بدون حباب، در هر حالتی. */
export interface BullionType {
  readonly kind: 'bullion';
  readonly id: string;
  readonly label: string;
  readonly karat: Karat;
}

/** بُعد شمارشی مستقل این سکه در دفتر کل. */
export function dimensionOf(coin: CoinType): AssetDimension {
  return coinDimension(coin.id);
}

/**
 * ارزش ذاتی یک سکه = وزن سکه × عیار سکه ÷ ۱۰۰۰ × نرخ گرم ۱۰۰۰.
 * این فقط طلای درون سکه است — حباب جداست.
 */
export function intrinsicValue(coin: CoinType, rate1000: Rial): Rial {
  return valueOfPure(toPureMg(coin.grossMg, coin.karat), rate1000);
}

/**
 * حباب سکه = قیمت بازار سکه − ارزش ذاتی.
 *
 * امضا فقط `CoinType` می‌پذیرد. این تنها ضامن قانون حباب است.
 * حباب می‌تواند منفی باشد (سکه زیر ارزش ذاتی) — خطا نیست.
 */
export function bubble(coin: CoinType, marketPrice: Rial, rate1000: Rial): Rial {
  return rial(marketPrice - intrinsicValue(coin, rate1000));
}

/**
 * قیمت شمش = وزن × عیار ÷ ۱۰۰۰ × نرخ گرم ۱۰۰۰.
 * تمام. بدون حباب، بدون پرمیوم، بدون استثنا.
 */
export function bullionPrice(weightMg: GrossMg, k: Karat, rate1000: Rial): Rial {
  return valueOfPure(toPureMg(weightMg, k), rate1000);
}

/**
 * ارزش کل یک موقعیت سکه‌ای — تعداد × قیمت بازار هر سکه.
 * ضرب در تعداد، نه تبدیل به گرم.
 */
export function coinPositionValue(count: number, marketPrice: Rial): Rial {
  return rial(BigInt(count) * marketPrice);
}
