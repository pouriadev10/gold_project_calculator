import { describe, expect, it } from 'vitest';
import { articlePureMg, chargeableGrossMg } from '../src/article.js';
import { toPureMg } from '../src/karat.js';
import { CalcError, grossMg, karat } from '../src/types.js';

const none = { stone: grossMg(0n), other: grossMg(0n) };

describe('chargeableGrossMg', () => {
  it('بدون کسورات، همان وزن ناخالص است', () => {
    expect(chargeableGrossMg(grossMg(12_000n), none)).toBe(12_000n);
  });

  it('نگین را کم می‌کند', () => {
    expect(
      chargeableGrossMg(grossMg(12_000n), { stone: grossMg(2_000n), other: grossMg(0n) }),
    ).toBe(10_000n);
  });

  it('سایر کسورات را هم کم می‌کند', () => {
    expect(
      chargeableGrossMg(grossMg(12_000n), { stone: grossMg(2_000n), other: grossMg(500n) }),
    ).toBe(9_500n);
  });

  it('کسورات برابر وزن ناخالص، صفر می‌دهد', () => {
    expect(
      chargeableGrossMg(grossMg(5_000n), { stone: grossMg(3_000n), other: grossMg(2_000n) }),
    ).toBe(0n);
  });

  it('کسورات بیشتر از وزن ناخالص خطا می‌دهد، نه وزن منفی', () => {
    expect(() =>
      chargeableGrossMg(grossMg(5_000n), { stone: grossMg(4_000n), other: grossMg(2_000n) }),
    ).toThrow(CalcError);
  });
});

describe('articlePureMg', () => {
  it('کسورات پیش از عیار اعمال می‌شوند', () => {
    // ۱۲ گرم ناخالص، ۲ گرم نگین، عیار ۷۵۰ → ۱۰ گرم × ۰٫۷۵ = ۷٫۵ گرم
    const pure = articlePureMg(
      grossMg(12_000n),
      { stone: grossMg(2_000n), other: grossMg(0n) },
      karat(750),
    );

    expect(pure).toBe(7_500n);
  });

  it('ترتیب برعکس نتیجه‌ی دیگری می‌داد — همان خطایی که این تابع می‌بندد', () => {
    const gross = grossMg(12_000n);
    const stone = grossMg(2_000n);
    const k = karat(750);

    const correct = articlePureMg(gross, { stone, other: grossMg(0n) }, k);
    const wrongOrder = toPureMg(gross, k) - stone;

    expect(correct).toBe(7_500n);
    expect(wrongOrder).toBe(7_000n);
    expect(correct).not.toBe(wrongOrder);
  });

  it('بدون کسورات با toPureMg یکی است', () => {
    const gross = grossMg(8_133n);
    const k = karat(900);

    expect(articlePureMg(gross, none, k)).toBe(toPureMg(gross, k));
  });

  it.each([
    [karat(750), 9_000n],
    [karat(875), 10_500n],
    [karat(995), 11_940n],
    [karat(1000), 12_000n],
  ])('عیار %s روی ۱۲ گرم خالصِ درست می‌دهد', (k, expected) => {
    expect(articlePureMg(grossMg(12_000n), none, k)).toBe(expected);
  });

  it('وزن صفرِ قابل محاسبه، خالص صفر می‌دهد', () => {
    expect(
      articlePureMg(grossMg(5_000n), { stone: grossMg(5_000n), other: grossMg(0n) }, karat(750)),
    ).toBe(0n);
  });

  it('کسورات بیش از حد، خطا را از chargeableGrossMg پاس می‌دهد', () => {
    expect(() =>
      articlePureMg(grossMg(1_000n), { stone: grossMg(2_000n), other: grossMg(0n) }, karat(750)),
    ).toThrow(CalcError);
  });
});
