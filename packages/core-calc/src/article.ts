/**
 * مصنوع (زیورآلات).
 *
 *   وزن قابل محاسبه = وزن ناخالص − وزن نگین − سایر کسورات
 *   وزن خالص طلا    = وزن قابل محاسبه × عیار ÷ ۱۰۰۰
 *
 * چرا اینجا و نه در سرویس API: نگین و کسورات **پیش از** اعمال عیار کم
 * می‌شوند. اگر جایی این ترتیب برعکس شود — یعنی عیار روی وزن ناخالص
 * اعمال و بعد نگین کم شود — مبلغ فاکتور غلط درمی‌آید و خطا به اندازه‌ی
 * وزن نگین است، که روی یک انگشتر می‌تواند چند درصد باشد.
 *
 * قاعده‌ی BE-025: «هیچ فرمول تکراری در API نوشته نشده باشد». تنها راهی
 * که موتور قیمت‌گذاری فروش (BE-040) و مدل کالا نتوانند از هم واگرا
 * شوند، این است که هر دو همین یک تابع را صدا بزنند.
 */

import { toPureMg } from './karat.js';
import { CalcError, grossMg } from './types.js';
import type { GrossMg, Karat, PureMg } from './types.js';

/** کسورات وزنی یک مصنوع. */
export interface ArticleDeductions {
  /** وزن نگین — طلا نیست و بابتش طلا فروخته نمی‌شود. */
  readonly stone: GrossMg;
  /** سایر کسورات: قفل غیرطلا، مینا، رزین و هر چیزی که طلا حساب نمی‌شود. */
  readonly other: GrossMg;
}

/**
 * وزنی که واقعاً طلاست — پیش از اعمال عیار.
 *
 * کسورات بیشتر از وزن ناخالص یعنی داده‌ی غلط، نه وزن منفی: خطا می‌دهد
 * تا در همان لحظه‌ی ثبت کالا دیده شود، نه وقتی فاکتور مبلغ منفی داد.
 */
export function chargeableGrossMg(gross: GrossMg, deductions: ArticleDeductions): GrossMg {
  const chargeable = gross - deductions.stone - deductions.other;

  if (chargeable < 0n) {
    throw new CalcError('مجموع کسورات از وزن ناخالص بیشتر است');
  }

  return grossMg(chargeable);
}

/** وزن طلای خالص ۱۰۰۰ یک مصنوع، پس از کسر نگین و سایر کسورات. */
export function articlePureMg(gross: GrossMg, deductions: ArticleDeductions, k: Karat): PureMg {
  return toPureMg(chargeableGrossMg(gross, deductions), k);
}
