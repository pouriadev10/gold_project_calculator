import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DIGIT_SPECS,
  bigIntToDigits,
  clearDigits,
  digitsToBigInt,
  isBlank,
  popDigit,
  pushDigit,
  pushSeparator,
} from '../src/input.js';
import type { DigitSpec } from '../src/input.js';
import { CalcError } from '../src/types.js';

const WEIGHT = DIGIT_SPECS.weight;
const KARAT = DIGIT_SPECS.karat;
const RIAL = DIGIT_SPECS.rial;

/** شبیه‌سازی تایپ کاربر روی کیپد. */
function type(keys: string, spec: DigitSpec = WEIGHT): string {
  let buffer = '';
  for (const key of keys) {
    buffer = key === '.' ? pushSeparator(buffer, spec) : pushDigit(buffer, key, spec);
  }
  return buffer;
}

describe('تایپ رقم', () => {
  it('ارقام پشت سر هم اضافه می‌شوند', () => {
    expect(type('123')).toBe('123');
  });

  it('صفر پیشوند جایگزین می‌شود، نه انباشته', () => {
    expect(type('05')).toBe('5');
    expect(type('000')).toBe('0');
  });

  it('پس از جداکننده، صفر پیشوند معنا دارد', () => {
    expect(type('0.05')).toBe('0.05');
  });

  it('بیش از ظرفیت بخش صحیح پذیرفته نمی‌شود — ضربه بی‌اثر است', () => {
    const full = type('1234567890', KARAT); // ظرفیت ۴ رقم
    expect(full).toBe('1234');
  });

  it('بیش از ارقام اعشار مجاز پذیرفته نمی‌شود', () => {
    expect(type('1.23456')).toBe('1.234'); // وزن سه رقم اعشار دارد
  });

  it('ورودی غیررقم خطا می‌دهد', () => {
    expect(() => pushDigit('1', 'a', WEIGHT)).toThrow(CalcError);
    expect(() => pushDigit('1', '12', WEIGHT)).toThrow(CalcError);
  });
});

describe('جداکننده‌ی اعشار', () => {
  it('روی بافر خالی «۰.» می‌سازد', () => {
    expect(pushSeparator('', WEIGHT)).toBe('0.');
  });

  it('دو بار زدن اثری ندارد', () => {
    expect(pushSeparator(pushSeparator('12', WEIGHT), WEIGHT)).toBe('12.');
  });

  it('روی فیلد بدون اعشار بی‌اثر است', () => {
    expect(pushSeparator('750', KARAT)).toBe('750');
    expect(pushSeparator('', RIAL)).toBe('');
  });
});

describe('حذف', () => {
  it('آخرین نویسه را برمی‌دارد', () => {
    expect(popDigit('12.3')).toBe('12.');
    expect(popDigit('1')).toBe('');
    expect(popDigit('')).toBe('');
  });

  it('پاک‌کردن کامل بافر خالی می‌دهد', () => {
    expect(clearDigits()).toBe('');
  });
});

describe('تبدیل به bigint — بدون هیچ float', () => {
  it('گرم با سه رقم اعشار به میلی‌گرم تبدیل می‌شود', () => {
    expect(digitsToBigInt('12.345', WEIGHT)).toBe(12_345n);
  });

  it('اعشار ناقص با صفر پر می‌شود', () => {
    expect(digitsToBigInt('12.3', WEIGHT)).toBe(12_300n);
    expect(digitsToBigInt('12.', WEIGHT)).toBe(12_000n);
    expect(digitsToBigInt('12', WEIGHT)).toBe(12_000n);
  });

  it('بافر خالی صفر است', () => {
    expect(digitsToBigInt('', WEIGHT)).toBe(0n);
    expect(digitsToBigInt('.', WEIGHT)).toBe(0n);
  });

  it('بدون بخش صحیح هم کار می‌کند', () => {
    expect(digitsToBigInt('.5', WEIGHT)).toBe(500n);
  });

  it('عیار و ریال بدون اعشارند', () => {
    expect(digitsToBigInt('750', KARAT)).toBe(750n);
    expect(digitsToBigInt('12500000', RIAL)).toBe(12_500_000n);
  });

  it('مبلغ فراتر از MAX_SAFE_INTEGER بدون افت دقت تبدیل می‌شود', () => {
    const huge = '9007199254740993123';
    expect(digitsToBigInt(huge, RIAL).toString()).toBe(huge);
  });

  /**
   * این تست معیار «مسیر ورودی هیچ‌جا از float عبور نمی‌کند» است.
   *
   * ۰.۱ + ۰.۲ روی float برابر ۰.۳۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۴ است. اگر جایی از
   * مسیر ورودی به float می‌رفت، این مقادیر خراب درمی‌آمدند.
   */
  it('مقادیری که float خرابشان می‌کند، دقیق می‌مانند', () => {
    expect(digitsToBigInt('0.1', WEIGHT)).toBe(100n);
    expect(digitsToBigInt('0.2', WEIGHT)).toBe(200n);
    expect(digitsToBigInt('0.3', WEIGHT)).toBe(300n);
    expect(digitsToBigInt('8.133', WEIGHT)).toBe(8_133n);
    expect(digitsToBigInt('4.6083', { decimals: 4, maxIntegerDigits: 6 })).toBe(46_083n);
    expect(digitsToBigInt('1.005', WEIGHT)).toBe(1_005n);
    expect(digitsToBigInt('2.675', WEIGHT)).toBe(2_675n);
  });
});

describe('رفت‌وبرگشت bigint ↔ رشته', () => {
  it('مقدار اولیه‌ی فیلد درست پر می‌شود', () => {
    expect(bigIntToDigits(12_345n, WEIGHT)).toBe('12.345');
    expect(bigIntToDigits(12_300n, WEIGHT)).toBe('12.3');
    expect(bigIntToDigits(12_000n, WEIGHT)).toBe('12');
    expect(bigIntToDigits(750n, KARAT)).toBe('750');
  });

  it('صفر بافر خالی می‌دهد', () => {
    expect(bigIntToDigits(0n, WEIGHT)).toBe('');
    expect(bigIntToDigits(0n, KARAT)).toBe('');
  });

  it('مقدار منفی رد می‌شود — بافر ورودی علامت ندارد', () => {
    expect(() => bigIntToDigits(-1n, WEIGHT)).toThrow(CalcError);
  });

  it('رفت‌وبرگشت روی ۱۰۰۰ مقدار تصادفی بدون خطا برمی‌گردد', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 999_999_999n }), (value) => {
        expect(digitsToBigInt(bigIntToDigits(value, WEIGHT), WEIGHT)).toBe(value);
      }),
      { numRuns: 1000 },
    );
  });

  it('هر توالی تایپ تصادفی، بافر معتبر می‌سازد', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9.]{0,12}$/u), (keys) => {
        const buffer = type(keys);
        // بافر هرگز بیش از یک جداکننده ندارد
        expect(buffer.split('.').length).toBeLessThanOrEqual(2);
        // و همیشه قابل تبدیل است
        expect(typeof digitsToBigInt(buffer, WEIGHT)).toBe('bigint');
      }),
      { numRuns: 500 },
    );
  });
});

describe('isBlank', () => {
  it('بافر خالی و صفرهای بی‌اثر خالی حساب می‌شوند', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank('0')).toBe(true);
    expect(isBlank('0.')).toBe(true);
    expect(isBlank('0.0')).toBe(true);
  });

  it('مقدار واقعی خالی نیست', () => {
    expect(isBlank('0.001')).toBe(false);
    expect(isBlank('1')).toBe(false);
  });
});
