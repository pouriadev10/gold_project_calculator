import { describe, expect, it } from 'vitest';
import { addDual, dualFromPure, dualFromRial, negateDual, zeroDual } from '../src/dual.js';
import { gramRate1000 } from '../src/pricing.js';

const RATE = gramRate1000(100_000_000n);

describe('dualFromRial', () => {
  it('مبلغ ریالی را به معادل طلا برمی‌گرداند', () => {
    const oneGramInRial = RATE;
    expect(dualFromRial(oneGramInRial, RATE).pureMg).toBe(1000n);
  });

  it('نرخ قفل‌شده را با خود حمل می‌کند', () => {
    expect(dualFromRial(1n, RATE).rate1000).toBe(RATE);
  });

  it('مبلغ منفی مجاز است — مانده‌ی بدهکار و زیان', () => {
    const negative = dualFromRial(-RATE, RATE);
    expect(negative.rial).toBeLessThan(0n);
    expect(negative.pureMg).toBe(-1000n);
  });
});

describe('dualFromPure', () => {
  it('وزن طلا را به معادل ریالی برمی‌گرداند', () => {
    expect(dualFromPure(1000n, RATE).rial).toBe(RATE);
  });

  it('با dualFromRial رفت‌وبرگشت سازگار است', () => {
    const fromGold = dualFromPure(250_000n, RATE); // ۲۵۰ گرم
    const roundTrip = dualFromRial(fromGold.rial, RATE);
    const drift = roundTrip.pureMg - fromGold.pureMg;
    expect(drift >= -1n && drift <= 1n).toBe(true);
  });
});

describe('گزارش گذشته با تغییر قیمت امروز عوض نمی‌شود', () => {
  it('همان وزن با نرخ قدیم، همان ریال دیروز را می‌دهد', () => {
    const yesterdayRate = gramRate1000(100_000_000n);
    const todayRate = gramRate1000(140_000_000n);

    const invoice = dualFromPure(10_000n, yesterdayRate);

    // امروز نرخ عوض شده، ولی سند نرخ خودش را دارد
    expect(invoice.rate1000).toBe(yesterdayRate);
    expect(invoice.rate1000).not.toBe(todayRate);
    expect(dualFromPure(10_000n, invoice.rate1000).rial).toBe(invoice.rial);
  });
});

describe('negateDual و zeroDual', () => {
  it('قرینه هر دو مقیاس را برمی‌گرداند و نرخ را نگه می‌دارد', () => {
    const amount = dualFromPure(5000n, RATE);
    const opposite = negateDual(amount);
    expect(opposite.pureMg).toBe(-amount.pureMg);
    expect(opposite.rial).toBe(-amount.rial);
    expect(opposite.rate1000).toBe(RATE);
  });

  it('صفر در هر دو مقیاس صفر است', () => {
    const z = zeroDual(RATE);
    expect(z.rial).toBe(0n);
    expect(z.pureMg).toBe(0n);
  });
});

describe('addDual', () => {
  it('دو مبلغ با نرخ یکسان را جمع می‌کند', () => {
    const sum = addDual(dualFromPure(1000n, RATE), dualFromPure(2000n, RATE));
    expect(sum.pureMg).toBe(3000n);
    expect(sum.rial).toBe(dualFromPure(3000n, RATE).rial);
  });

  it('جمع دو نرخ متفاوت خطا می‌دهد — به‌جای ساختن بی‌صدای عدد غلط', () => {
    expect(() =>
      addDual(dualFromPure(1000n, RATE), dualFromPure(1000n, gramRate1000(200_000_000n))),
    ).toThrow('جمع دو مبلغ با نرخ قفل‌شده‌ی متفاوت مجاز نیست');
  });
});
