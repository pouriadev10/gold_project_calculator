import { describe, expect, it } from 'vitest';
import {
  bigIntStringSchema,
  nonNegativeBigIntStringSchema,
  positiveBigIntStringSchema,
} from '../src/index.js';

describe('bigIntStringSchema', () => {
  it.each(['0', '1', '12500000', '-1', '-12500000', '9'.repeat(40)])(
    'مقدار معتبر %s را می‌پذیرد',
    (value) => {
      expect(bigIntStringSchema.parse(value)).toBe(value);
    },
  );

  it('مقدار پذیرفته‌شده دقیقاً همان رشته می‌ماند و به number تبدیل نمی‌شود', () => {
    const parsed = bigIntStringSchema.parse('12500000');

    expect(parsed).toBe('12500000');
    expect(typeof parsed).toBe('string');
  });

  it('عددی بزرگ‌تر از Number.MAX_SAFE_INTEGER بدون از دست دادن رقم عبور می‌کند', () => {
    const beyondSafeInteger = '9007199254740993';

    expect(bigIntStringSchema.parse(beyondSafeInteger)).toBe(beyondSafeInteger);
    expect(BigInt(bigIntStringSchema.parse(beyondSafeInteger))).toBe(9007199254740993n);
  });

  it.each([
    ['12.5', 'اعشار'],
    ['12,500', 'جداکننده‌ی هزارگان'],
    ['۱۲۳', 'ارقام فارسی'],
    ['١٢٣', 'ارقام عربی'],
    ['007', 'صفر ابتدایی'],
    ['+7', 'علامت مثبت صریح'],
    ['-0', 'منفی صفر'],
    [' 12 ', 'فاصله'],
    ['', 'رشته‌ی خالی'],
    ['1e3', 'نماد علمی'],
    ['0x1f', 'مبنای شانزده'],
    ['12n', 'پسوند bigint'],
    ['abc', 'حروف'],
    ['9'.repeat(41), 'بیش از ۴۰ رقم'],
  ])('مقدار نامعتبر %s را رد می‌کند (%s)', (value) => {
    expect(bigIntStringSchema.safeParse(value).success).toBe(false);
  });

  it.each([12500000, 12.5, null, undefined, true, {}, []])(
    'ورودی غیررشته‌ای را رد می‌کند: %s',
    (value) => {
      expect(bigIntStringSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('nonNegativeBigIntStringSchema', () => {
  it.each(['0', '1', '12500000'])('مقدار %s را می‌پذیرد', (value) => {
    expect(nonNegativeBigIntStringSchema.parse(value)).toBe(value);
  });

  it.each(['-1', '-12500000'])('مقدار منفی %s را رد می‌کند', (value) => {
    expect(nonNegativeBigIntStringSchema.safeParse(value).success).toBe(false);
  });

  it('مقدار نامتعارف را هم مثل schema پایه رد می‌کند', () => {
    expect(nonNegativeBigIntStringSchema.safeParse('007').success).toBe(false);
    expect(nonNegativeBigIntStringSchema.safeParse('12.5').success).toBe(false);
  });
});

describe('positiveBigIntStringSchema', () => {
  it.each(['1', '12500000'])('مقدار %s را می‌پذیرد', (value) => {
    expect(positiveBigIntStringSchema.parse(value)).toBe(value);
  });

  it('صفر را رد می‌کند', () => {
    expect(positiveBigIntStringSchema.safeParse('0').success).toBe(false);
  });

  it.each(['-1', '-12500000'])('مقدار منفی %s را رد می‌کند', (value) => {
    expect(positiveBigIntStringSchema.safeParse(value).success).toBe(false);
  });
});
