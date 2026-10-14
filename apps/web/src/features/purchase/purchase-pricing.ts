import {
  calculateSecondHandGoldPurchase,
  CalcError,
  dualFromRial,
  gramRate,
  grossMg,
  karat as toKarat,
  RATE_DIVISOR,
  toSafeNumber,
  type DualAmount,
  type Rial,
  type SecondHandGoldPurchaseCalculation,
} from '@gold/core-calc';
import { generalSettingValueError, type GeneralSettingKey, type GeneralSettings } from '@/api/contracts';

/**
 * مقدار مؤثر و معتبر یک کلید از `GET /settings/general` (FE-095) — همان نسخه‌ای که سرور هنگام
 * ثبت خرید می‌خواند (`second-hand-gold-purchases.service.ts`). نامعتبر یا ناموجود ← `undefined`،
 * نه حدس و نه عدد پیش‌فرض کد (قاعده‌ی ۲-۶).
 */
function settingValue(settings: GeneralSettings | undefined, key: GeneralSettingKey): string | undefined {
  const value = settings?.settings.find((setting) => setting.key === key)?.value;
  return value === undefined || generalSettingValueError(key, value) !== null ? undefined : value;
}

/** عیار پیش‌فرض خرید دست‌دوم همین مستأجر — سرور وقتی `purchaseKarat` نیامده همین را می‌خواند. */
export function tenantDefaultPurchaseKarat(settings: GeneralSettings | undefined): number | undefined {
  const value = settingValue(settings, 'purchase.second_hand_default_karat');
  return value === undefined ? undefined : toSafeNumber(BigInt(value));
}

/** واحد گرد کردن ریالی مستأجر — سرور مبلغ خرید را با همین گرد می‌کند. */
export function tenantRoundingUnitRial(settings: GeneralSettings | undefined): bigint | undefined {
  const value = settingValue(settings, 'pricing.rial_rounding_unit');
  return value === undefined ? undefined : BigInt(value);
}

/**
 * ورودی‌های خام فرم وزن‌کشی خرید طلای دست‌دوم — همه‌چیز رشته‌ای، آماده برای ذخیره در پیش‌نویس.
 */
export interface SecondHandWeighingInput {
  readonly grossWeightMg: string;
  readonly stoneWeightMg: string;
  readonly otherDeductionWeightMg: string;
  readonly purchaseKarat: number;
  readonly feeRial: string;
}

export interface SecondHandWeighingCalculation extends SecondHandGoldPurchaseCalculation {
  /** کارمزد کسرشده به ریال. */
  readonly feeRial: bigint;
  /** وزن خالص پیش از اعمال عیار (وزن ناخالص منهای نگین و سایر متعلقات). */
  readonly netWeightMg: bigint;
  /** نرخ هر گرم طلای عیار خرید انتخابی (مثلاً عیار ۷۴۰). */
  readonly purchaseKaratRatePerGramRial: Rial;
  /** مبالغ دو مقیاسه (طلا و ریال) برای نمایش سراسری. */
  readonly dualGrossPurchaseAmount: DualAmount;
  readonly dualFeeAmount: DualAmount;
  readonly dualFinalAmount: DualAmount;
}

export type SecondHandWeighingResult =
  | { readonly ok: true; readonly calc: SecondHandWeighingCalculation }
  | { readonly ok: false; readonly error: string };

/**
 * محاسبه‌ی زنده‌ی مشخصات و مبالغ خرید طلای دست‌دوم از مصرف‌کننده (FE-057).
 *
 * همه‌ی محاسبات مستقیماً از `@gold/core-calc` می‌آیند — همان کدی که سرور در
 * `SecondHandGoldPurchasesService` برای ثبت نهایی اجرا می‌کند.
 *
 * `roundingUnitRial` اجباری است و پیش‌فرض ندارد (FE-095): واحد گرد کردن تنظیم نسخه‌دار مستأجر
 * است (`tenantRoundingUnitRial`). با عدد ثابت کد، «مبلغ نهایی» پیش‌نمایش با سرور فرق می‌کرد و
 * «پرداخت کامل» — که همان عدد پیش‌نمایش را می‌فرستد — از مبلغ سرور بیشتر می‌شد و رد می‌شد.
 * `undefined` (تنظیمات هنوز نرسیده) پیش‌نمایشی نمی‌سازد.
 */
export function calculateSecondHandWeighing(
  input: SecondHandWeighingInput,
  maznehRial: bigint,
  roundingUnitRial: bigint | undefined,
  rateDivisor: bigint = RATE_DIVISOR,
): SecondHandWeighingResult {
  if (roundingUnitRial === undefined) {
    return { ok: false, error: 'تنظیم گرد کردن مبلغ فروشگاه هنوز دریافت نشده است' };
  }
  try {
    const grossWeight = BigInt(input.grossWeightMg || '0');
    const stoneWeight = BigInt(input.stoneWeightMg || '0');
    const otherDeductionWeight = BigInt(input.otherDeductionWeightMg || '0');
    const fee = BigInt(input.feeRial || '0');
    const karatNum = input.purchaseKarat;

    if (grossWeight <= 0n) {
      return { ok: false, error: 'وزن ناخالص باید بیشتر از صفر باشد' };
    }

    const totalDeductions = stoneWeight + otherDeductionWeight;
    if (totalDeductions >= grossWeight) {
      return { ok: false, error: 'مجموع وزن کسورات نمی‌تواند بیشتر یا مساوی وزن ناخالص باشد' };
    }

    if (karatNum < 1 || karatNum > 1000) {
      return { ok: false, error: 'عیار خرید باید عددی بین ۱ تا ۱۰۰۰ باشد' };
    }

    if (maznehRial <= 0n) {
      return { ok: false, error: 'مظنه جاری نامعتبر است' };
    }

    const validKarat = toKarat(karatNum);

    const calc = calculateSecondHandGoldPurchase({
      grossWeightMg: grossWeight,
      deductions: {
        stone: grossMg(stoneWeight),
        other: grossMg(otherDeductionWeight),
      },
      purchaseKarat: validKarat,
      maznehRial,
      feeRial: fee,
      roundingUnitRial,
      rateDivisor,
    });

    const netWeightMg = grossWeight - totalDeductions;
    const purchaseKaratRatePerGramRial = gramRate(maznehRial, validKarat, rateDivisor);

    const dualGrossPurchaseAmount = dualFromRial(calc.grossPurchaseAmountRial, calc.goldRatePerGramRial);
    const dualFeeAmount = dualFromRial(fee, calc.goldRatePerGramRial);
    const dualFinalAmount = dualFromRial(calc.finalAmountRial, calc.goldRatePerGramRial);

    return {
      ok: true,
      calc: {
        ...calc,
        feeRial: fee,
        netWeightMg,
        purchaseKaratRatePerGramRial,
        dualGrossPurchaseAmount,
        dualFeeAmount,
        dualFinalAmount,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof CalcError ? error.message : 'محاسبه وزن‌کشی ناموفق بود',
    };
  }
}
