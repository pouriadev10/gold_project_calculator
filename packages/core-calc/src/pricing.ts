/**
 * موتور نرخ.
 *
 *   عیار پایه‌ی مظنه = ۷۰۵   (طلای آبشده‌ی ۱۷ عیار — قرارداد بازار)
 *   ثابت تبدیل       = ۴.۶۰۸۳ × ۷۰۵ = ۳۲۴۸.۸۵۱۵
 *   نرخ هر گرم عیار k = مظنه × k ÷ ۳۲۴۸.۸۵۱۵
 *
 * ⚠️ فرمول `(مظنه ÷ ۴.۶۰۸۳) × (عیار ÷ ۷۵۰)` غلط است — عیار پایه‌ی مظنه
 * را ۱۰۰۰ فرض می‌کند در حالی که ۷۰۵ است. حدود ۶٪ خطا روی هر فاکتور.
 */

import { mulDivHalfUp } from './rounding.js';
import { KARAT_BASE, rial } from './types.js';
import type { Karat, PureMg, Rial } from './types.js';

/** عیار پایه‌ی مظنه — قرارداد بازار، نه انتخاب ما. */
export const MAZNEH_BASE_KARAT = 705;

/** ۳۲۴۸.۸۵۱۵ × ۱۰⁴ — مخرج تبدیل مظنه به نرخ گرم. */
export const RATE_DIVISOR = 32_488_515n;

/** مقیاس صورت کسر، هم‌تراز با `RATE_DIVISOR`. */
export const RATE_SCALE = 10_000n;

/**
 * نرخ هر گرم طلای عیار k بر حسب ریال.
 *
 * تقسیم صحیح رو به پایین است — عمداً، تا با جدول پذیرش بخش ۲ BOOTSTRAP
 * مو‌به‌مو بخواند. این عدد مبنای فاکتور است و نباید بین دو اجرا فرق کند.
 *
 * `divisor` پارامتر است نه ثابت، چون قاعده‌ی ۲-۶ CLAUDE.md می‌گوید
 * عدد صنفی باید نسخه‌دار و از دیتابیس بیاید. پیش‌فرض فقط برای فاز ۱ است.
 */
export function gramRate(maznehRial: bigint, k: Karat, divisor: bigint = RATE_DIVISOR): Rial {
  return rial((maznehRial * BigInt(k) * RATE_SCALE) / divisor);
}

/** نرخ هر گرم طلای خالص ۱۰۰۰ — مبنای ارزش ذاتی سکه و قیمت شمش. */
export function gramRate1000(maznehRial: bigint, divisor: bigint = RATE_DIVISOR): Rial {
  return gramRate(maznehRial, KARAT_BASE as Karat, divisor);
}

/** ارزش ریالی یک وزن طلای خالص، با نرخ گرم ۱۰۰۰ داده‌شده. */
export function valueOfPure(pure: PureMg, rate1000: Rial): Rial {
  return rial(mulDivHalfUp(pure, rate1000, 1000n));
}
