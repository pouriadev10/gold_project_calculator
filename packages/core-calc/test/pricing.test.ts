import { describe, expect, it } from 'vitest';
import {
  MAZNEH_BASE_KARAT,
  RATE_DIVISOR,
  gramRate,
  gramRate1000,
  valueOfPure,
} from '../src/pricing.js';
import { toSafeNumber } from '../src/number-bridge.js';
import { karat, pureMg, rial } from '../src/types.js';

const MAZNEH = 100_000_000n;

describe('gramRate — جدول پذیرش بخش ۲ BOOTSTRAP', () => {
  // این چهار عدد مرجع ثابت‌اند. تغییرشان بدون تأیید صریح ممنوع است.
  const cases: ReadonlyArray<readonly [number, bigint]> = [
    [705, 21_699_976n],
    [740, 22_777_279n],
    [750, 23_085_080n],
    [995, 30_626_207n],
  ];

  for (const [k, expected] of cases) {
    it(`مظنه ۱۰۰٬۰۰۰٬۰۰۰ ریال، عیار ${k} → ${expected}`, () => {
      expect(gramRate(MAZNEH, karat(k))).toBe(expected);
    });
  }
});

describe('عیار پایه‌ی مظنه', () => {
  it('۷۰۵ است، نه ۱۰۰۰', () => {
    expect(MAZNEH_BASE_KARAT).toBe(705);
  });

  it('ثابت تبدیل برابر ۴.۶۰۸۳ × ۷۰۵ در مقیاس ۱۰⁴ است', () => {
    // 46083 × 705 = 32488515 — یعنی ۳۲۴۸.۸۵۱۵
    expect(RATE_DIVISOR).toBe(46_083n * 705n);
  });

  it('فرمول غلط ÷۴.۶۰۸۳ رد می‌شود — حدود ۶٪ اختلاف روی هر فاکتور', () => {
    const correct = gramRate(MAZNEH, karat(750));

    // فرمول غلطی که در سند علامت‌گذاری شده: (مظنه ÷ ۴.۶۰۸۳) × (عیار ÷ ۷۵۰)
    const wrong = (MAZNEH * 10_000n * 750n) / (46_083n * 750n);

    expect(wrong).not.toBe(correct);

    // فرمول غلط عیار پایه را ۱۰۰۰ فرض می‌کند، پس نرخ را کم‌تر از واقع می‌دهد
    expect(wrong).toBeLessThan(correct);

    const driftPercent = Math.abs(toSafeNumber(((wrong - correct) * 10_000n) / correct) / 100);
    expect(driftPercent).toBeGreaterThan(5);
    expect(driftPercent).toBeLessThan(7);
  });
});

describe('gramRate — خواص', () => {
  it('نسبت به عیار یکنواخت صعودی است', () => {
    expect(gramRate(MAZNEH, karat(750))).toBeGreaterThan(gramRate(MAZNEH, karat(740)));
    expect(gramRate(MAZNEH, karat(995))).toBeGreaterThan(gramRate(MAZNEH, karat(750)));
  });

  it('مخرج قابل جایگزینی است — عدد صنفی هاردکد نیست', () => {
    const custom = gramRate(MAZNEH, karat(750), 32_000_000n);
    expect(custom).not.toBe(gramRate(MAZNEH, karat(750)));
  });

  it('gramRate1000 همان gramRate با عیار ۱۰۰۰ است', () => {
    expect(gramRate1000(MAZNEH)).toBe(gramRate(MAZNEH, karat(1000)));
    expect(gramRate1000(MAZNEH, 32_000_000n)).toBe(gramRate(MAZNEH, karat(1000), 32_000_000n));
  });

  it('مظنه‌ی صفر نرخ صفر می‌دهد', () => {
    expect(gramRate(0n, karat(750))).toBe(0n);
  });
});

describe('valueOfPure', () => {
  it('یک گرم خالص دقیقاً برابر نرخ گرم است', () => {
    const rate = gramRate1000(MAZNEH);
    expect(valueOfPure(pureMg(1000n), rate)).toBe(rate);
  });

  it('نسبت به وزن خطی است', () => {
    const rate = rial(1_000_000n);
    expect(valueOfPure(pureMg(5000n), rate)).toBe(5_000_000n);
  });
});
