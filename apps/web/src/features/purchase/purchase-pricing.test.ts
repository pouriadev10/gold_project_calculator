import { describe, expect, it } from 'vitest';
import { calculateSecondHandWeighing } from './purchase-pricing';

describe('calculateSecondHandWeighing — FE-057', () => {
  const baseInput = {
    grossWeightMg: '1000',
    stoneWeightMg: '100',
    otherDeductionWeightMg: '0',
    purchaseKarat: 740,
    feeRial: '25000',
  };
  const maznehRial = 100_000_000n;

  it('محاسبات وزن‌کشی و پیش‌نمایش مبالغ را مطابق با هسته محاسبات انجام می‌دهد', () => {
    const result = calculateSecondHandWeighing(baseInput, maznehRial);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.calc.netWeightMg).toBe(900n);
    expect(result.calc.pureWeightMg).toBe(666n);
    expect(result.calc.goldRatePerGramRial).toBe(30_780_107n);
    expect(result.calc.purchaseKaratRatePerGramRial).toBe(22_777_279n);
    expect(result.calc.grossPurchaseAmountRial).toBe(20_499_551n);
    expect(result.calc.finalAmountRial).toBe(20_475_000n);
    expect(result.calc.dualFinalAmount.rial).toBe(20_475_000n);
  });

  it('در صورت صفر یا منفی بودن وزن ناخالص خطا می‌دهد', () => {
    const result = calculateSecondHandWeighing({ ...baseInput, grossWeightMg: '0' }, maznehRial);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('بیشتر از صفر');
    }
  });

  it('در صورتی که کسورات بیشتر یا مساوی وزن ناخالص باشند خطا می‌دهد', () => {
    const result = calculateSecondHandWeighing(
      { ...baseInput, stoneWeightMg: '1000' },
      maznehRial,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('کسورات');
    }
  });

  it('در صورتی که کارمزد از مبلغ ناخالص بیشتر باشد خطا می‌دهد', () => {
    const result = calculateSecondHandWeighing(
      { ...baseInput, feeRial: '30000000' },
      maznehRial,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it('تغییر عیار، نرخ گرم و طلای خالص را به‌روزرسانی می‌کند', () => {
    const result750 = calculateSecondHandWeighing(
      { ...baseInput, purchaseKarat: 750, feeRial: '0' },
      maznehRial,
    );
    expect(result750.ok).toBe(true);
    if (!result750.ok) return;

    // ۹۰۰ میلی‌گرم با عیار ۷۵۰ => ۶۷۵ میلی‌گرم خالص
    expect(result750.calc.pureWeightMg).toBe(675n);
    expect(result750.calc.purchaseKaratRatePerGramRial).toBe(23_085_080n);
  });
});
