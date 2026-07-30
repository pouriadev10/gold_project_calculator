import { describe, expect, it } from 'vitest';
import {
  GRAM_DECIMALS,
  MESGHAL_DECIMALS,
  formatCoinCount,
  formatGram,
  formatKarat,
  formatMesghal,
  formatRial,
  formatScaled,
} from '../src/format.js';
import { toLatinDigits } from '../src/persian.js';

const DECIMAL_SEPARATOR = String.fromCodePoint(0x066b);
const MINUS_SIGN = String.fromCodePoint(0x2212);

describe('formatRial', () => {
  it('با ارقام فارسی و گروه‌بندی سه‌رقمی نمایش می‌دهد', () => {
    const out = formatRial(12_500_000n);
    expect(toLatinDigits(out).replace(/\D/gu, '')).toBe('12500000');
    expect(out).not.toMatch(/[0-9]/u);
  });

  it('صفر را درست نشان می‌دهد', () => {
    expect(toLatinDigits(formatRial(0n))).toBe('0');
  });

  it('منفی را با علامت منفی ریاضی نشان می‌دهد', () => {
    expect(formatRial(-5000n).startsWith(MINUS_SIGN)).toBe(true);
  });

  it('اعداد فراتر از MAX_SAFE_INTEGER را بدون افت دقت نشان می‌دهد', () => {
    const huge = 9_007_199_254_740_993_123n;
    expect(toLatinDigits(formatRial(huge)).replace(/\D/gu, '')).toBe('9007199254740993123');
  });
});

describe('formatGram', () => {
  it('میلی‌گرم را با سه رقم اعشار به گرم تبدیل می‌کند', () => {
    expect(GRAM_DECIMALS).toBe(3);
    const out = formatGram(7_319_700n); // ۷۳۱۹.۷ گرم
    expect(toLatinDigits(out)).toContain(`7${DECIMAL_SEPARATOR}`.slice(0, 1));
    expect(toLatinDigits(out).split(DECIMAL_SEPARATOR)[1]).toBe('700');
  });

  it('ارقام اعشار همیشه سه‌تایی است — ستون جدول نمی‌لرزد', () => {
    expect(toLatinDigits(formatGram(5n)).split(DECIMAL_SEPARATOR)[1]).toBe('005');
    expect(toLatinDigits(formatGram(50n)).split(DECIMAL_SEPARATOR)[1]).toBe('050');
    expect(toLatinDigits(formatGram(1000n)).split(DECIMAL_SEPARATOR)[1]).toBe('000');
  });

  it('وزن منفی علامت می‌گیرد', () => {
    expect(formatGram(-1500n).startsWith(MINUS_SIGN)).toBe(true);
  });
});

describe('formatMesghal', () => {
  it('چهار رقم اعشار دارد', () => {
    expect(MESGHAL_DECIMALS).toBe(4);
    expect(toLatinDigits(formatMesghal(100_000n)).split(DECIMAL_SEPARATOR)[1]).toBe('0000');
  });
});

describe('formatScaled', () => {
  it('با decimals صفر هیچ جداکننده‌ی اعشاری نمی‌گذارد', () => {
    expect(formatScaled(1234n, 0)).not.toContain(DECIMAL_SEPARATOR);
  });
});

describe('formatCoinCount و formatKarat', () => {
  it('تعداد سکه عدد صحیح شمارشی است', () => {
    expect(toLatinDigits(formatCoinCount(12))).toBe('12');
  });

  it('عیار بدون گروه‌بندی نمایش داده می‌شود', () => {
    expect(formatKarat(750)).toBe('۷۵۰');
    expect(formatKarat(995)).toBe('۹۹۵');
    expect(formatKarat(1000)).toBe('۱۰۰۰');
  });
});
