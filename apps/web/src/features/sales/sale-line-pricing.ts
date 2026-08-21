import {
  calculateJewelrySale,
  CalcError,
  DEFAULT_ROUNDING_UNIT,
  grossMg,
  karat as toKarat,
  RATE_DIVISOR,
  type JewelrySaleCalculation,
} from '@gold/core-calc';
import type { JewelryItemVersion } from '@/api/contracts';
import type { SaleDraftItemLine, SaleLinePricingInput } from '@/stores/sale-draft-store';

/**
 * محاسبه‌ی زنده‌ی قیمت یک ردیف فروش — FE-043.
 *
 * ⚠️ `DEFAULT_PROFIT_RATE_BPS`/`DEFAULT_TAX_RATE_BPS` باید از تنظیمات
 * نسخه‌دار مستأجر بیایند (`sales.jewelry_profit_rate_bps` = `700`،
 * `tax.gold_jewelry_labor_profit_commission_rate_bps` = `1000`، هر دو در
 * `apps/api/src/modules/pricing/tenant-initial-settings.ts`) — همان مقدار
 * seed فاز ۱ اینجا عیناً تکرار شده چون `VersionedSettingsService` **هیچ
 * کنترلر HTTP** ندارد؛ این تنظیمات فقط از داخل سرویس‌های سرور خواندنی‌اند
 * (`SalesPricingService.priceJewelryInTransaction`)، نه از فرانت. افزودن
 * یک endpoint خواندنی برای این تنظیمات کار یک تسک بک‌اندی جداست.
 *
 * این دو عدد فقط **مقدار اولیه‌ی یک فیلد قابل‌ویرایش** هستند، نه یک ثابت
 * پنهان — «سود» و «مالیات» هر دو در فهرست فیلدهای این تسک‌اند، پس کاربر
 * بلافاصله در فرم می‌بیندشان و می‌تواند دست بزند. `RATE_DIVISOR`
 * (`@gold/core-calc`) و `DEFAULT_ROUNDING_UNIT` برعکس، عدد صنفی نیستند —
 * برابر همان مقدار seed مستأجر (۷۰۵ عیار مبنا × ۴٫۶۰۸۳ گرم مثقال =
 * ۳۲٬۴۸۸٬۵۱۵ = `RATE_DIVISOR`، و ۱۰۰۰ ریال = `DEFAULT_ROUNDING_UNIT`)
 * هستند و از قبل در `useMazneh.ts` (FE-029) هم به همین شکل (بدون آرگومان
 * صریح) استفاده می‌شوند — اینجا ثابت‌های عمومی `core-calc` را صریح پاس
 * می‌دهیم، نه یک نسخه‌ی محلی تازه از همان اعداد.
 *
 * قاعده‌ی «نتیجه نهایی server-authoritative» یعنی خروجی این تابع هرگز در
 * `sale-draft-store.ts` ذخیره نمی‌شود — فقط `SaleLinePricingInput` (ورودی)
 * ذخیره می‌شود؛ عدد نهایی همیشه از اینجا دوباره محاسبه می‌شود، هرجا لازم
 * باشد (فهرست ردیف‌ها، خودِ ویرایشگر، بعداً خلاصه‌ی فاکتور در FE-044).
 */
export const DEFAULT_PROFIT_RATE_BPS = 700n;
export const DEFAULT_TAX_RATE_BPS = 1000n;

/** مقدار اولیه‌ی ویرایشگر برای ردیف کاتالوگ — از آخرین نسخه‌ی کالا. */
export function defaultPricingFromCatalog(item: JewelryItemVersion): SaleLinePricingInput {
  return {
    grossWeightMg: item.grossWeightMg,
    karat: item.karat,
    stoneWeightMg: item.stoneWeightMg,
    otherDeductionWeightMg: item.otherDeductionWeightMg,
    wageType: item.wageType,
    wageValue: item.wageValue,
    profitRateBps: DEFAULT_PROFIT_RATE_BPS.toString(),
    taxRateBps: DEFAULT_TAX_RATE_BPS.toString(),
  };
}

/** مقدار اولیه‌ی ویرایشگر برای ردیف موردی — از وزن/عیار «ورود سریع» FE-042؛ بقیه صفر/پیش‌فرض. */
export function defaultPricingFromAdhoc(
  line: Extract<SaleDraftItemLine, { kind: 'ADHOC' }>,
): SaleLinePricingInput {
  return {
    grossWeightMg: line.grossWeightMg,
    karat: line.karat,
    stoneWeightMg: '0',
    otherDeductionWeightMg: '0',
    wageType: 'PER_GRAM',
    wageValue: '0',
    profitRateBps: DEFAULT_PROFIT_RATE_BPS.toString(),
    taxRateBps: DEFAULT_TAX_RATE_BPS.toString(),
  };
}

export type LinePricingResult =
  | { readonly ok: true; readonly calc: JewelrySaleCalculation }
  | { readonly ok: false; readonly error: string };

/** پل میان `SaleLinePricingInput` (رشته‌ای، storage-ready) و `calculateJewelrySale` واقعی — همان تابعی که سرور صدا می‌زند. */
export function calculateLinePricing(pricing: SaleLinePricingInput, maznehRial: bigint): LinePricingResult {
  try {
    const calc = calculateJewelrySale({
      grossWeightMg: BigInt(pricing.grossWeightMg),
      karat: toKarat(pricing.karat),
      deductions: {
        stone: grossMg(BigInt(pricing.stoneWeightMg)),
        other: grossMg(BigInt(pricing.otherDeductionWeightMg)),
      },
      wageType: pricing.wageType,
      wageValue: BigInt(pricing.wageValue),
      maznehRial,
      profitRateBps: BigInt(pricing.profitRateBps),
      taxRateBps: BigInt(pricing.taxRateBps),
      roundingUnitRial: DEFAULT_ROUNDING_UNIT,
      rateDivisor: RATE_DIVISOR,
    });
    return { ok: true, calc };
  } catch (error) {
    return { ok: false, error: error instanceof CalcError ? error.message : 'محاسبه ناموفق بود' };
  }
}
