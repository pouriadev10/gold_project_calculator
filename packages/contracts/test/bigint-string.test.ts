import { describe, expect, it } from 'vitest';
import {
  DB_BIGINT_MAX,
  DB_BIGINT_MIN,
  MAX_COIN_COUNT,
  bigIntStringSchema,
  coinCountSchema,
  nonNegativeBigIntStringSchema,
  positiveBigIntStringSchema,
} from '../src/index.js';

describe('bigIntStringSchema', () => {
  it.each(['0', '1', '12500000', '-1', '-12500000', '9223372036854775807', '-9223372036854775808'])(
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
    ['9'.repeat(20), 'بیش از ۱۹ رقم'],
    ['9'.repeat(40), 'چهل رقم — سقف قبلی'],
  ])('مقدار نامعتبر %s را رد می‌کند (%s)', (value) => {
    expect(bigIntStringSchema.safeParse(value).success).toBe(false);
  });

  it.each(['9223372036854775808', '-9223372036854775809', '9999999999999999999'])(
    'مقدار ۱۹ رقمی بیرون از بازه‌ی bigint پستگرس (%s) با پیام همان فیلد رد می‌شود، نه با ۵۰۰ ِ INSERT',
    (value) => {
      const result = bigIntStringSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        'مقدار از بازه‌ی قابل ذخیره‌سازی بیرون است',
      ]);
    },
  );

  it('مرزها همان ثابت‌های صادرشده‌اند', () => {
    expect(DB_BIGINT_MAX).toBe(2n ** 63n - 1n);
    expect(DB_BIGINT_MIN).toBe(-(2n ** 63n));
  });

  it('رشته‌ی نامتعارف فقط خطای قالب می‌گیرد — BigInt روی آن اجرا نمی‌شود', () => {
    const result = bigIntStringSchema.safeParse('12.5');
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
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

  it('سقف bigint پستگرس را از schema پایه به ارث می‌برد', () => {
    expect(positiveBigIntStringSchema.safeParse('9223372036854775807').success).toBe(true);
    expect(positiveBigIntStringSchema.safeParse('9223372036854775808').success).toBe(false);
  });
});

describe('coinCountSchema', () => {
  it.each([1, 5, MAX_COIN_COUNT])('تعداد صحیح مثبت %s را می‌پذیرد', (value) => {
    expect(coinCountSchema.parse(value)).toBe(value);
  });

  it.each([
    [0, 'صفر'],
    [-1, 'منفی'],
    [1.5, 'کسری'],
    [MAX_COIN_COUNT + 1, 'بیش از سقف int4'],
    [1e20, 'عدد غول‌آسایی که Number.isInteger قبولش دارد'],
  ])('تعداد %s را رد می‌کند (%s)', (value) => {
    expect(coinCountSchema.safeParse(value).success).toBe(false);
  });

  it.each(['5', null, undefined])('ورودی غیرعددی %s را رد می‌کند', (value) => {
    expect(coinCountSchema.safeParse(value).success).toBe(false);
  });
});
