import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DIGIT_SPECS,
  bigIntToDigits,
  clearDigits,
  digitsToBigInt,
  isBlank,
  pasteDigits,
  popDigit,
  pushDigit,
  pushSeparator,
} from '../src/input.js';
import type { DigitSpec } from '../src/input.js';
import { CalcError } from '../src/types.js';

const WEIGHT = DIGIT_SPECS.weight;
const KARAT = DIGIT_SPECS.karat;
const RIAL = DIGIT_SPECS.rial;
const PERCENT = DIGIT_SPECS.percent;

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

  it('وزن مرجع سکه با شش رقم اعشار دقیقاً میکروگرم می‌دهد', () => {
    const COIN_WEIGHT = DIGIT_SPECS.coinWeight;
    expect(digitsToBigInt('4.0665', COIN_WEIGHT)).toBe(4_066_500n);
    expect(digitsToBigInt('8.133', COIN_WEIGHT)).toBe(8_133_000n);
    expect(type('1.0166009', COIN_WEIGHT)).toBe('1.016600');
  });

  it('عیار و ریال بدون اعشارند', () => {
    expect(digitsToBigInt('750', KARAT)).toBe(750n);
    expect(digitsToBigInt('12500000', RIAL)).toBe(12_500_000n);
  });

  it('درصد با دو رقم اعشار دقیقاً مقیاس PERCENT_X100 را می‌دهد', () => {
    // ۷٫۵٪ باید همان ۷۵۰ ذخیره‌شده‌ی PERCENT_X100 در قرارداد اجرت زیورآلات باشد
    expect(digitsToBigInt('7.5', PERCENT)).toBe(750n);
    expect(digitsToBigInt('7', PERCENT)).toBe(700n);
    expect(digitsToBigInt('0.25', PERCENT)).toBe(25n);
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

describe('pasteDigits — چسباندن متن', () => {
  it('ارقام فارسی و لاتین یک بافر یکسان می‌دهند', () => {
    expect(pasteDigits('۱۲۳۴۵', RIAL)).toBe(pasteDigits('12345', RIAL));
    expect(pasteDigits('۱۲۳۴۵', RIAL)).toBe('12345');
  });

  it('ارقام عربی هم پذیرفته می‌شوند', () => {
    expect(pasteDigits('١٢٣٤٥', RIAL)).toBe('12345');
  });

  it('جداکننده‌ی اعشار فارسی (٫) مثل نقطه عمل می‌کند', () => {
    expect(pasteDigits('۱۲٫۳۴۵', WEIGHT)).toBe('12.345');
    expect(pasteDigits('12.345', WEIGHT)).toBe('12.345');
  });

  it('جداساز هزارگان و واحد نادیده گرفته می‌شوند', () => {
    expect(pasteDigits('۱۲۵,۰۰۰ ریال', RIAL)).toBe('125000');
    expect(pasteDigits('12,500,000', RIAL)).toBe('12500000');
  });

  it('FE-092: عددی که فیلد دقیقاً نگه نمی‌دارد رد می‌شود — نه بریده، نه گرد، نه چسبیده', () => {
    expect(pasteDigits('12345678901234', KARAT)).toBe(''); // ظرفیت عیار ۴ رقم
    expect(pasteDigits('1.234567', WEIGHT)).toBe(''); // ظرفیت اعشار وزن ۳ رقم
    expect(pasteDigits('1234567.5', WEIGHT)).toBe(''); // ظرفیت صحیح وزن ۶ رقم
    expect(pasteDigits('12500.75', RIAL)).toBe(''); // قبلاً «1250075» — ارقام به هم می‌چسبیدند
    expect(pasteDigits('۱۲۵۰۰٫۷۵', RIAL)).toBe('');
    expect(pasteDigits('2.5', DIGIT_SPECS.count)).toBe(''); // قبلاً ۲۵ سکه
    expect(pasteDigits('750.5', KARAT)).toBe(''); // قبلاً ۷۵۰۵
    expect(pasteDigits('123456789012345678901234567890', RIAL)).toBe(''); // قبلاً ۱۵ رقم اول
  });

  it('FE-092: علامت منفی رد می‌شود — فیلدهای ورودی منفی ندارند و علامت بی‌صدا حذف نمی‌شود', () => {
    expect(pasteDigits('-500', RIAL)).toBe('');
    expect(pasteDigits('\u2212۵۰۰', RIAL)).toBe('');
    expect(pasteDigits('۵۰۰-', RIAL)).toBe('');
  });

  it('FE-092: بیش از یک جداکننده‌ی اعشار مبهم است و رد می‌شود', () => {
    expect(pasteDigits('12.500.000', RIAL)).toBe('');
    expect(pasteDigits('1.2.3', WEIGHT)).toBe('');
  });

  it('FE-092: صفرهای انتهای اعشار عدد را عوض نمی‌کنند و پذیرفته‌اند', () => {
    expect(pasteDigits('12500.00', RIAL)).toBe('12500');
    expect(pasteDigits('۱۲۵٬۰۰۰٫۰ ریال', RIAL)).toBe('125000');
    expect(pasteDigits('1.2340', WEIGHT)).toBe('1.234');
    expect(pasteDigits('750.000', KARAT)).toBe('750');
    expect(pasteDigits('7.50', PERCENT)).toBe('7.50');
  });

  it('FE-092: «/» هم مثل کیبورد کیپد جداکننده‌ی اعشار است (۲/۵ گرم)', () => {
    expect(pasteDigits('۲/۵', WEIGHT)).toBe('2.5');
    expect(digitsToBigInt(pasteDigits('۲/۵', WEIGHT), WEIGHT)).toBe(2_500n);
  });

  it('FE-092: شکل بافر همان شکل تایپ است (صفر پیشوند، «۰٫»)', () => {
    expect(pasteDigits('.5', WEIGHT)).toBe(type('.5', WEIGHT));
    expect(pasteDigits('0.5', WEIGHT)).toBe(type('0.5', WEIGHT));
    expect(pasteDigits('000', RIAL)).toBe(type('000', RIAL));
    expect(pasteDigits('12.', WEIGHT)).toBe(type('12.', WEIGHT));
  });

  it('FE-092: هر عدد داخل ظرفیت دقیقاً همان مقدار را می‌دهد؛ هر عدد بیرون از آن هیچ', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{1,8}$/u),
        fc.stringMatching(/^[0-9]{0,5}$/u),
        (integer, fraction) => {
          const text = fraction ? `${integer}.${fraction}` : integer;
          const significantInteger = integer.replace(/^0+/u, '');
          const significantFraction = fraction.replace(/0+$/u, '');
          const fits = significantInteger.length <= WEIGHT.maxIntegerDigits && significantFraction.length <= WEIGHT.decimals;
          const buffer = pasteDigits(text, WEIGHT);
          if (!fits) return buffer === '';
          const expectedMg = BigInt(`${integer}${(fraction + '000').slice(0, 3)}`);
          return digitsToBigInt(buffer, WEIGHT) === expectedMg;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('صفر پیشوند همان رفتار تایپ را دارد', () => {
    expect(pasteDigits('007', RIAL)).toBe(type('007', RIAL));
  });

  it('جای‌گزین می‌کند، نه اضافه — نتیجه فقط به متن چسبانده‌شده وابسته است', () => {
    expect(pasteDigits('500', RIAL)).toBe('500');
  });

  it('متن کاملاً غیرعددی، بافر خالی می‌دهد نه یک بافر نیمه‌خراب', () => {
    expect(pasteDigits('سلام', RIAL)).toBe('');
    expect(pasteDigits('', RIAL)).toBe('');
  });

  it('خروجی همیشه با digitsToBigInt قابل تبدیل است — هرگز مقدار نامعتبر نمی‌سازد', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (text) => {
        const buffer = pasteDigits(text, WEIGHT);
        expect(buffer.split('.').length).toBeLessThanOrEqual(2);
        expect(typeof digitsToBigInt(buffer, WEIGHT)).toBe('bigint');
      }),
      { numRuns: 300 },
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
