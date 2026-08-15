import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MESGHAL_MG_X10,
  MESGHAL_SCALE,
  fromPureMg,
  fromPureMgSigned,
  gramToMesghal,
  karatLatticeMg,
  mesghalToGram,
  toPureMg,
} from '../src/karat.js';
import { grossMg, karat, pureMg } from '../src/types.js';

const K750 = karat(750);
const K995 = karat(995);
const K740 = karat(740);

describe('toPureMg — وزن خالص = وزن ناخالص × عیار ÷ ۱۰۰۰', () => {
  it('۱۰ گرم عیار ۷۵۰ برابر ۷.۵ گرم خالص است', () => {
    expect(toPureMg(grossMg(10_000n), K750)).toBe(7500n);
  });

  it('عیار ۱۰۰۰ وزن را تغییر نمی‌دهد', () => {
    expect(toPureMg(grossMg(12_345n), karat(1000))).toBe(12_345n);
  });

  it('سکه تمام بهار: ۸.۱۳۳ گرم عیار ۹۰۰ → ۷.۳۱۹۷ گرم خالص', () => {
    expect(toPureMg(grossMg(8133n), karat(900))).toBe(7320n); // ۷۳۱۹.۷ گرد شده
  });
});

describe('fromPureMg', () => {
  it('وارون toPureMg است', () => {
    expect(fromPureMg(pureMg(7500n), K750)).toBe(10_000n);
  });
});

describe('fromPureMgSigned — نسخه‌ی علامت‌دار برای نمایش مبالغ دفتر کل (FE-025)', () => {
  it('برای مقادیر مثبت با fromPureMg یکی است', () => {
    expect(fromPureMgSigned(7500n, K750)).toBe(fromPureMg(pureMg(7500n), K750));
  });

  it('مانده‌ی بدهکار (منفی) را هم درست به معادل عیار می‌برد — قرینه‌ی حالت مثبت', () => {
    expect(fromPureMgSigned(-7500n, K750)).toBe(-10_000n);
  });

  it('صفر صفر می‌ماند', () => {
    expect(fromPureMgSigned(0n, K750)).toBe(0n);
  });

  it('روی عیار ۱۰۰۰ وزن را تغییر نمی‌دهد', () => {
    expect(fromPureMgSigned(-12_345n, karat(1000))).toBe(-12_345n);
  });
});

describe('karatLatticeMg — شبکه‌ی وزن‌های دقیقاً نمایش‌پذیر', () => {
  it('برای عیار ۷۵۰ برابر ۴ میلی‌گرم است', () => {
    expect(karatLatticeMg(K750)).toBe(4n);
  });

  it('برای عیار ۹۹۵ برابر ۲۰۰ و برای ۷۴۰ برابر ۵۰ میلی‌گرم است', () => {
    expect(karatLatticeMg(K995)).toBe(200n);
    expect(karatLatticeMg(K740)).toBe(50n);
  });

  it('برای عیار ۱۰۰۰ برابر ۱ است', () => {
    expect(karatLatticeMg(karat(1000))).toBe(1n);
  });
});

describe('رفت‌وبرگشت عیار — property-based', () => {
  it('روی شبکه‌ی عیار ۷۵۰ خطای صفر می‌دهد (۱۰۰۰ مقدار تصادفی)', () => {
    const step = karatLatticeMg(K750);

    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000n }), (k) => {
        const gross = grossMg(k * step);
        const back = fromPureMg(toPureMg(gross, K750), K750);
        expect(back).toBe(gross);
      }),
      { numRuns: 1000 },
    );
  });

  it('روی شبکه‌ی عیارهای ۹۹۵ و ۷۴۰ هم خطای صفر می‌دهد', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.constantFrom(K995, K740),
        (k, kt) => {
          const gross = grossMg(k * karatLatticeMg(kt));
          expect(fromPureMg(toPureMg(gross, kt), kt)).toBe(gross);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('خارج از شبکه، خطا حداکثر ۱ میلی‌گرم است — سقف ذاتی ذخیره‌سازی صحیح', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 100_000_000n }), (g) => {
        const gross = grossMg(g);
        const back = fromPureMg(toPureMg(gross, K750), K750);
        const drift = back > gross ? back - gross : gross - back;
        expect(drift).toBeLessThanOrEqual(1n);
      }),
      { numRuns: 1000 },
    );
  });

  it('هیچ‌گاه انباشته نمی‌شود: صد بار رفت‌وبرگشت روی شبکه ثابت می‌ماند', () => {
    let value = grossMg(5232n); // مضرب ۴
    for (let i = 0; i < 100; i += 1) {
      value = fromPureMg(toPureMg(value, K750), K750);
    }
    expect(value).toBe(5232n);
  });
});

describe('مثقال', () => {
  it('مثقال برابر ۴.۶۰۸۳ گرم است', () => {
    expect(MESGHAL_MG_X10).toBe(46_083n);
    expect(MESGHAL_SCALE).toBe(10_000n);
  });

  it('۴۶۰۸.۳ میلی‌گرم دقیقاً یک مثقال است', () => {
    expect(gramToMesghal(4608n)).toBe(9_999n); // ۰.۹۹۹۹ مثقال
    expect(gramToMesghal(46_083n)).toBe(100_000n); // ۱۰ مثقال
  });

  it('رفت‌وبرگشت مثقال پایدار است', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1_000_000n }), (mg) => {
        const back = mesghalToGram(gramToMesghal(mg));
        const drift = back > mg ? back - mg : mg - back;
        expect(drift).toBeLessThanOrEqual(1n);
      }),
      { numRuns: 1000 },
    );
  });

  it('برای مانده‌ی منفی هم علامت را درست نگه می‌دارد — نمایش مثقال روی مبلغ دفتر کل', () => {
    expect(gramToMesghal(-46_083n)).toBe(-100_000n);
  });
});
