import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDING_UNIT, mulDivHalfUp, roundHalfUp } from '../src/rounding.js';
import { CalcError } from '../src/types.js';

describe('roundHalfUp', () => {
  it('واحد پیش‌فرض ۱۰۰۰ ریال است', () => {
    expect(DEFAULT_ROUNDING_UNIT).toBe(1000n);
  });

  it('زیر نصف به پایین می‌رود', () => {
    expect(roundHalfUp(1499n)).toBe(1000n);
  });

  it('دقیقاً نصف به بالا می‌رود', () => {
    expect(roundHalfUp(1500n)).toBe(2000n);
  });

  it('بالای نصف به بالا می‌رود', () => {
    expect(roundHalfUp(1501n)).toBe(2000n);
  });

  it('مضرب دقیق دست‌نخورده می‌ماند', () => {
    expect(roundHalfUp(2000n)).toBe(2000n);
    expect(roundHalfUp(0n)).toBe(0n);
  });

  it('برای مقادیر منفی متقارن است — نصف از صفر دور می‌شود', () => {
    expect(roundHalfUp(-1500n)).toBe(-2000n);
    expect(roundHalfUp(-1499n)).toBe(-1000n);
    expect(roundHalfUp(-1501n)).toBe(-2000n);
  });

  it('واحد دلخواه را می‌پذیرد', () => {
    expect(roundHalfUp(1234n, 1n)).toBe(1234n);
    expect(roundHalfUp(1250n, 500n)).toBe(1500n);
    expect(roundHalfUp(1249n, 500n)).toBe(1000n);
  });

  it('واحد صفر یا منفی خطا می‌دهد', () => {
    expect(() => roundHalfUp(100n, 0n)).toThrow(CalcError);
    expect(() => roundHalfUp(100n, -5n)).toThrow('واحد گرد کردن باید مثبت باشد');
  });

  it('روی اعداد بسیار بزرگ دقت را از دست نمی‌دهد', () => {
    const huge = 9_007_199_254_740_993_500n; // فراتر از Number.MAX_SAFE_INTEGER
    expect(roundHalfUp(huge)).toBe(9_007_199_254_740_994_000n);
  });
});

describe('mulDivHalfUp', () => {
  it('ضرب پیش از تقسیم انجام می‌شود — دقت میانی حفظ می‌شود', () => {
    // اگر اول تقسیم می‌شد، 1/3 صفر می‌شد و نتیجه صفر درمی‌آمد
    expect(mulDivHalfUp(1n, 1000n, 3n)).toBe(333n);
  });

  it('نیم را به بالا می‌برد', () => {
    expect(mulDivHalfUp(1n, 5n, 2n)).toBe(3n);
    expect(mulDivHalfUp(1n, 4n, 2n)).toBe(2n);
  });

  it('برای علامت‌های مختلف از صفر دور می‌شود', () => {
    expect(mulDivHalfUp(-1n, 5n, 2n)).toBe(-3n);
    expect(mulDivHalfUp(1n, -5n, 2n)).toBe(-3n);
    expect(mulDivHalfUp(1n, 5n, -2n)).toBe(-3n);
    expect(mulDivHalfUp(-1n, -5n, 2n)).toBe(3n);
    expect(mulDivHalfUp(-1n, 5n, -2n)).toBe(3n);
  });

  it('صفر را درست برمی‌گرداند', () => {
    expect(mulDivHalfUp(0n, 5n, 2n)).toBe(0n);
  });

  it('تقسیم بر صفر خطا می‌دهد', () => {
    expect(() => mulDivHalfUp(1n, 1n, 0n)).toThrow('تقسیم بر صفر');
  });
});
