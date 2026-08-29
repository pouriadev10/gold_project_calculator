import {
  calculateSecondHandGoldPurchase,
  CalcError,
  DEFAULT_ROUNDING_UNIT,
  dualFromRial,
  gramRate,
  grossMg,
  karat as toKarat,
  RATE_DIVISOR,
  type DualAmount,
  type Rial,
  type SecondHandGoldPurchaseCalculation,
} from '@gold/core-calc';

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
 */
export function calculateSecondHandWeighing(
  input: SecondHandWeighingInput,
  maznehRial: bigint,
  roundingUnitRial: bigint = DEFAULT_ROUNDING_UNIT,
  rateDivisor: bigint = RATE_DIVISOR,
): SecondHandWeighingResult {
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
