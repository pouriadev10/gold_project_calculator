import { describe, expect, it } from 'vitest';
import { calculateJewelrySale, rateDivisorFromMarketSettings } from '../src/jewelry-sale.js';
import { RATE_DIVISOR } from '../src/pricing.js';
import { CalcError } from '../src/types.js';
import { grossMg, karat } from '../src/types.js';

const baseInput = {
  grossWeightMg: 12_000n,
  karat: karat(750),
  deductions: { stone: grossMg(2_000n), other: grossMg(0n) },
  wageType: 'PER_GRAM' as const,
  wageValue: 350_000n,
  maznehRial: 100_000_000n,
  profitRateBps: 700n,
  taxRateBps: 1_000n,
  roundingUnitRial: 1_000n,
  rateDivisor: 32_488_515n,
};

describe('calculateJewelrySale', () => {
  it('uses the net weight, applies tax only to wage and profit, and rounds once at the end', () => {
    const result = calculateJewelrySale(baseInput);

    expect(result).toMatchObject({
      pureWeightMg: 7_500n,
      goldRatePerGramRial: 23_085_080n,
      goldValueRial: 230_850_800n,
      wageRial: 3_500_000n,
      profitRial: 16_404_556n,
      taxRial: 1_990_456n,
      payableBeforeRoundingRial: 252_745_812n,
      payableRial: 252_746_000n,
    });
  });

  it.each([
    ['PERCENT_X100', 700n, 17_290_725n],
    ['FLAT', 3_500_000n, 16_404_556n],
  ] as const)('supports %s wage without duplicating the gold formula', (wageType, wageValue, profitRial) => {
    const result = calculateJewelrySale({ ...baseInput, wageType, wageValue });

    expect(result.profitRial).toBe(profitRial);
  });

  it('rejects negative financial inputs', () => {
    expect(() => calculateJewelrySale({ ...baseInput, taxRateBps: -1n })).toThrow();
  });
});

describe('rateDivisorFromMarketSettings', () => {
  it('قرارداد بازار (مثقال ۴٫۶۰۸۳ گرم، عیار پایه‌ی ۷۰۵) همان ثابت ۳۲۴۸٫۸۵۱۵ را می‌دهد', () => {
    expect(rateDivisorFromMarketSettings(karat(705), 46_083n)).toBe(RATE_DIVISOR);
  });

  it('نسخه‌ی دیگر تنظیمات مقسوم‌علیه دیگری می‌دهد — عدد صنفی در کد ثابت نیست', () => {
    expect(rateDivisorFromMarketSettings(karat(750), 46_083n)).toBe(34_562_250n);
  });

  it.each([0n, -46_083n])('مثقال غیرمثبت (%s) رد می‌شود', (mithqal) => {
    expect(() => rateDivisorFromMarketSettings(karat(705), mithqal)).toThrow(CalcError);
  });
});
