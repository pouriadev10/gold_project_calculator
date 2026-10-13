import {
  MAX_SAFE_BIGINT,
  fromPureMgSigned,
  gramToMesghal,
  isSafeNumber,
  karat,
  mesghalToGram,
  toLatinDigits,
  toPersianDigits,
  toSafeNumber,
} from '@gold/core-calc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS_BY_KIND, type Shortcut } from '@/components/keypad/shortcuts';
import {
  addBigIntStrings,
  compareBigIntStrings,
  formatIntegerString,
  formatRial,
  formatWeightMg,
  parseBigIntString,
  subtractBigIntStrings,
} from './bigint';

/**
 * FE-091 — تست utilityهای عددی فرانت.
 *
 * پوشش تسک، هر کدام یک بخش: BigInt string · فرمت ریال · فرمت وزن · تبدیل گرم · ارقام فارسی ·
 * مقدار بسیار بزرگ · مقدار منفی · صفر. کنار نمونه‌های دقیق، ویژگی‌ها با `fast-check` روی کل
 * بازه سنجیده می‌شوند (بسیار بزرگ، منفی و صفر هم جزو مولدند)، نه فقط چند عدد دست‌چین.
 *
 * `bigint.test.ts` (FE-010) نمونه‌های پایه را دارد؛ این فایل مرزها و ویژگی‌ها را می‌افزاید.
 * خودِ core-calc پوشش ۱۰۰٪ جداگانه دارد — اینجا همان توابع از مسیری سنجیده می‌شوند که فرانت
 * واقعاً به کار می‌برد (رشته‌ی API ← bigint ← متن نمایشی، و میان‌برهای کیپد).
 */

/** جداکننده‌ها و علامت‌هایی که قالب‌بندی فارسی به کار می‌برد. */
const GROUP = '٬'; // ٬
const DECIMAL = '٫'; // ٫
const MINUS = '−'; // − (علامت منفی تایپوگرافیک، نه خط تیره)

/** متن نمایشی → رشته‌ی لاتین بی‌جداکننده، برای مقایسه با مقدار مرجع. */
const plain = (formatted: string): string =>
  toLatinDigits(formatted).replaceAll(GROUP, '').replaceAll(DECIMAL, '.').replaceAll(MINUS, '-');

/** میلی‌گرم → «گرم با سه رقم اعشار» با حساب رشته‌ای، مستقل از کدی که آزموده می‌شود. */
function gramsText(mg: bigint): string {
  const negative = mg < 0n;
  const digits = (negative ? -mg : mg).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -3)}.${digits.slice(-3)}`;
}

/**
 * سقف قرارداد `bigIntStringSchema`: ۴۰ رقم (`packages/contracts/src/common/bigint-string.ts`).
 * مولدها داخل همین دامنه‌اند؛ مرز خودش جداگانه در «مقدار بسیار بزرگ» سنجیده می‌شود.
 */
const MAX_40_DIGITS = 10n ** 40n - 1n;

/** هر عدد صحیح مجاز قرارداد، از صفر تا ۴۰ رقم، مثبت و منفی — با تمرکز روی مرز number. */
const anyBigInt = fc.oneof(
  fc.bigInt({ min: -MAX_40_DIGITS, max: MAX_40_DIGITS }),
  fc.bigInt({ min: -MAX_SAFE_BIGINT - 10n, max: MAX_SAFE_BIGINT + 10n }),
  fc.constantFrom(
    0n,
    1n,
    -1n,
    999n,
    1000n,
    -1000n,
    MAX_SAFE_BIGINT,
    MAX_SAFE_BIGINT + 1n,
    -MAX_SAFE_BIGINT - 1n,
    MAX_40_DIGITS,
    -MAX_40_DIGITS,
  ),
);

/** دو عملوندی که حاصل جمع/تفریقشان هم داخل ۴۰ رقم می‌ماند. */
const operand = fc.oneof(
  fc.bigInt({ min: -(10n ** 39n), max: 10n ** 39n }),
  fc.bigInt({ min: -MAX_SAFE_BIGINT - 10n, max: MAX_SAFE_BIGINT + 10n }),
  fc.constantFrom(0n, 1n, -1n, MAX_SAFE_BIGINT, MAX_SAFE_BIGINT + 1n),
);

const LATIN_TO_ARABIC_INDIC = (latin: string): string =>
  latin.replace(/[0-9]/gu, (d) => String.fromCharCode(0x0660 + Number.parseInt(d, 10)));

function weightShortcut(label: string): Extract<Shortcut, { type: 'transform' }> {
  const shortcut = SHORTCUTS_BY_KIND.weight.find((s) => s.label === label);
  if (shortcut?.type !== 'transform') throw new Error(`میان‌بر وزن «${label}» پیدا نشد`);
  return shortcut;
}

describe('FE-091 · BigInt string', () => {
  it('رشته‌ی canonical هر عدد صحیح دقیقاً همان bigint را می‌دهد', () => {
    fc.assert(fc.property(anyBigInt, (value) => parseBigIntString(value.toString()) === value));
  });

  it('شکل‌های غیر canonical رد می‌شوند — ورودی مبهم هرگز حدس زده نمی‌شود', () => {
    for (const input of [
      '',
      ' 5',
      '5 ',
      '1e3',
      '0x10',
      '12.5',
      '007',
      '+7',
      '-0',
      '-۰',
      '۱۲٬۳۴۵',
      '1,000',
      '−500',
    ]) {
      expect(() => parseBigIntString(input), input).toThrow();
    }
  });

  it('جمع، تفریق و مقایسه دقیقاً همان حساب bigint است و خروجی canonical می‌ماند', () => {
    fc.assert(
      fc.property(operand, operand, (a, b) => {
        const [sa, sb] = [a.toString(), b.toString()];
        return (
          addBigIntStrings(sa, sb) === (a + b).toString() &&
          subtractBigIntStrings(sa, sb) === (a - b).toString() &&
          compareBigIntStrings(sa, sb) === (a < b ? -1 : a > b ? 1 : 0)
        );
      }),
    );
  });

  it('خروجی جمع و تفریق دوباره قابل parse است (زنجیره‌ی محاسبه روی رشته‌ها نمی‌شکند)', () => {
    fc.assert(
      fc.property(operand, operand, (a, b) => {
        const sum = addBigIntStrings(a.toString(), b.toString());
        return parseBigIntString(subtractBigIntStrings(sum, b.toString())) === a;
      }),
    );
  });
});

describe('FE-091 · فرمت ریال', () => {
  it.each([
    ['0', '۰'],
    ['7', '۷'],
    ['999', '۹۹۹'],
    ['1000', '۱٬۰۰۰'],
    ['1234567', '۱٬۲۳۴٬۵۶۷'],
    ['-1', '−۱'],
    ['-1000', '−۱٬۰۰۰'],
  ])('%s ← %s', (input, expected) => {
    expect(formatRial(input)).toBe(expected);
  });

  it('برای هر مقدار، متن نمایشی همان عدد است — بی‌کم‌وکاست، فقط با ارقام فارسی و جداکننده', () => {
    fc.assert(
      fc.property(anyBigInt, (value) => plain(formatRial(value.toString())) === value.toString()),
    );
  });

  it('جداکننده‌ی هزارگان دقیقاً هر سه رقم است، از راست', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 30n }), (value) => {
        const groups = toLatinDigits(formatRial(value.toString())).split(GROUP);
        return (
          groups.slice(1).every((group) => group.length === 3) &&
          groups[0]!.length >= 1 &&
          groups[0]!.length <= 3
        );
      }),
    );
  });

  it('ورودی با ارقام فارسی یا عربی همان نتیجه‌ی ورودی لاتین را می‌دهد', () => {
    fc.assert(
      fc.property(anyBigInt, (value) => {
        const latin = value.toString();
        const expected = formatRial(latin);
        return (
          formatRial(toPersianDigits(latin)) === expected &&
          formatRial(LATIN_TO_ARABIC_INDIC(latin)) === expected
        );
      }),
    );
  });
});

describe('FE-091 · فرمت وزن (میلی‌گرم → گرم)', () => {
  it.each([
    ['0', '۰٫۰۰۰'],
    ['5', '۰٫۰۰۵'],
    ['999', '۰٫۹۹۹'],
    ['1000', '۱٫۰۰۰'],
    ['9217', '۹٫۲۱۷'],
    ['1234567', '۱٬۲۳۴٫۵۶۷'],
    ['-1000', '−۱٫۰۰۰'],
  ])('%s میلی‌گرم ← %s', (input, expected) => {
    expect(formatWeightMg(input)).toBe(expected);
  });

  it('همیشه دقیقاً سه رقم اعشار — میلی‌گرم هرگز گرد یا حذف نمی‌شود', () => {
    fc.assert(
      fc.property(anyBigInt, (mg) => plain(formatWeightMg(mg.toString())) === gramsText(mg)),
    );
  });

  it('منفیِ کمتر از یک گرم علامتش را نگه می‌دارد (۰ − ۵ میلی‌گرم ≠ ۵ میلی‌گرم)', () => {
    expect(formatWeightMg('-5')).toBe('−۰٫۰۰۵');
    expect(formatWeightMg('-999')).toBe('−۰٫۹۹۹');
    fc.assert(
      fc.property(fc.bigInt({ min: -999n, max: -1n }), (mg) =>
        formatWeightMg(mg.toString()).startsWith(`${MINUS}۰${DECIMAL}`),
      ),
    );
  });
});

describe('FE-091 · تبدیل گرم', () => {
  it('میان‌بر «مثقال» کیپد عیناً همان mesghalToGram ِ core-calc است — ثابت تکراری از آن جدا نمی‌افتد', () => {
    const mesghal = weightShortcut('مثقال');
    // کاربر «۲» زده = ۲٫۰۰۰ در بافر وزن = ۲۰۰۰ واحد میلی‌گرمی؛ یعنی ۲ مثقال در مقیاس ۱۰⁴ = ۲۰۰۰۰
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 999_999_999n }),
        (typed) => mesghal.apply(typed) === mesghalToGram(typed * 10n),
      ),
    );
  });

  it.each([
    [1_000n, 4_608n], // ۱ مثقال = ۴٫۶۰۸۳ گرم → ۴٬۶۰۸ میلی‌گرم (نیمه به بالا)
    [2_000n, 9_217n], // ۲ مثقال = ۹٫۲۱۶۶ گرم → ۹٬۲۱۷
    [10_000n, 46_083n], // ۱۰ مثقال = ۴۶٫۰۸۳ گرم، دقیق
    [0n, 0n],
  ])('میان‌بر «مثقال»: %s ← %s میلی‌گرم', (typed, mg) => {
    expect(weightShortcut('مثقال').apply(typed)).toBe(mg);
  });

  it('رفت‌وبرگشت گرم ↔ مثقال حداکثر یک واحد کوچک‌ترین مقیاس خطا دارد', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), (mg) => {
        const back = mesghalToGram(gramToMesghal(mg));
        return back - mg <= 1n && mg - back <= 1n;
      }),
    );
  });

  it('میان‌برهای ÷۵ و ×۲ وزن دقیق‌اند (÷۵ با گرد کردن نیمه به بالا ِ core-calc)', () => {
    const divide = weightShortcut('÷۵');
    const double = weightShortcut('×۲');
    expect(divide.apply(10_000n)).toBe(2_000n);
    expect(divide.apply(7n)).toBe(1n); // ۱٫۴
    expect(divide.apply(8n)).toBe(2n); // ۱٫۶
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 18n }), (v) => double.apply(v) === v * 2n),
    );
  });

  it('گرم خالص ← معادل عیار ۷۵۰ (نمای «گرم معادل»): ۷۵۰ خالص = ۱٬۰۰۰، و نسبت به علامت قرینه است', () => {
    const k750 = karat(750);
    expect(fromPureMgSigned(750n, k750)).toBe(1_000n);
    expect(fromPureMgSigned(-750n, k750)).toBe(-1_000n);
    expect(fromPureMgSigned(0n, k750)).toBe(0n);
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 20n }),
        (pure) => fromPureMgSigned(-pure, k750) === -fromPureMgSigned(pure, k750),
      ),
    );
  });
});

describe('FE-091 · ارقام فارسی', () => {
  it('لاتین ↔ فارسی برای هر رشته‌ی رقمی بی‌اتلاف رفت‌وبرگشت می‌کند', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{0,40}$/u),
        (latin) => toLatinDigits(toPersianDigits(latin)) === latin,
      ),
    );
  });

  it('ارقام عربی (٠-٩) و ترکیب سه خط به همان عدد لاتین می‌رسند', () => {
    expect(toLatinDigits('١٢٣')).toBe('123');
    expect(parseBigIntString('۱2٣')).toBe(123n);
    expect(parseBigIntString('۰')).toBe(0n);
  });

  it('فقط ارقام عوض می‌شوند — علامت، جداکننده و متن دست نمی‌خورند', () => {
    expect(toPersianDigits('-12.5 گرم')).toBe('-۱۲.۵ گرم');
    expect(toLatinDigits('۱۲٫۵')).toBe('12٫5');
  });

  it('متن نمایشی پول و وزن هرگز رقم لاتین ندارد، ولی مقدار ذخیره‌شده لاتین است', () => {
    fc.assert(
      fc.property(anyBigInt, (value) => {
        const text = `${formatRial(value.toString())}${formatWeightMg(value.toString())}${formatIntegerString(value.toString())}`;
        return !/[0-9]/u.test(text);
      }),
    );
  });
});

describe('FE-091 · مقدار بسیار بزرگ', () => {
  const HUGE = '123456789012345678901234567890123456789';

  it('بزرگ‌تر از MAX_SAFE_INTEGER بی‌هیچ از دست رفتن دقت قالب‌بندی می‌شود', () => {
    expect(plain(formatRial(HUGE))).toBe(HUGE);
    expect(plain(formatWeightMg(HUGE))).toBe(gramsText(BigInt(HUGE)));
    expect(plain(formatRial(`-${HUGE}`))).toBe(`-${HUGE}`);
  });

  it('درست بالای مرز number، رقم آخر نمی‌پرد (۲⁵³ + ۱ با number همان ۲⁵³ می‌شد)', () => {
    const unsafe = (MAX_SAFE_BIGINT + 2n).toString(); // 9007199254740993
    expect(plain(formatRial(unsafe))).toBe('9007199254740993');
    expect(addBigIntStrings(unsafe, '1')).toBe('9007199254740994');
    expect(compareBigIntStrings(unsafe, (MAX_SAFE_BIGINT + 1n).toString())).toBe(1);
  });

  it('سقف قرارداد: ۴۰ رقم (با یا بی علامت) پذیرفته، ۴۱ رقم رد می‌شود — نه بریده یا گرد', () => {
    const forty = MAX_40_DIGITS.toString();
    expect(forty).toHaveLength(40);
    expect(parseBigIntString(forty)).toBe(MAX_40_DIGITS);
    expect(parseBigIntString(`-${forty}`)).toBe(-MAX_40_DIGITS);
    expect(plain(formatRial(forty))).toBe(forty);
    expect(() => parseBigIntString((MAX_40_DIGITS + 1n).toString())).toThrow();
    expect(() => formatRial((MAX_40_DIGITS + 1n).toString())).toThrow();
  });

  it('تنها پل bigint → number بیرون از بازه‌ی امن به‌جای گرد کردن بی‌صدا می‌شکند', () => {
    expect(toSafeNumber(MAX_SAFE_BIGINT)).toBe(Number.MAX_SAFE_INTEGER);
    expect(toSafeNumber(-MAX_SAFE_BIGINT)).toBe(-Number.MAX_SAFE_INTEGER);
    expect(() => toSafeNumber(MAX_SAFE_BIGINT + 1n)).toThrow();
    expect(() => toSafeNumber(-MAX_SAFE_BIGINT - 1n)).toThrow();
    expect(isSafeNumber(MAX_SAFE_BIGINT + 1n)).toBe(false);
  });
});

describe('FE-091 · مقدار منفی', () => {
  it('منفی با علامت تایپوگرافیک «−» نمایش داده می‌شود، نه خط تیره، و پیش از ارقام', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 30n), max: -1n }), (value) => {
        const rial = formatRial(value.toString());
        const weight = formatWeightMg(value.toString());
        return (
          rial.startsWith(MINUS) &&
          weight.startsWith(MINUS) &&
          !rial.includes('-') &&
          !weight.includes('-')
        );
      }),
    );
  });

  it('قدر مطلق منفی همان متن مثبت است — علامت فقط یک پیشوند است', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 30n }), (value) => {
        const s = value.toString();
        return (
          formatRial(`-${s}`) === `${MINUS}${formatRial(s)}` &&
          formatWeightMg(`-${s}`) === `${MINUS}${formatWeightMg(s)}`
        );
      }),
    );
  });

  it('مقایسه‌ی منفی‌ها درست است (−۱۰ < −۹)', () => {
    expect(compareBigIntStrings('-10', '-9')).toBe(-1);
    expect(compareBigIntStrings('-90071992547409931', '-90071992547409930')).toBe(-1);
  });
});

describe('FE-091 · صفر', () => {
  it('صفر در هر قالبی بدون علامت است — «−۰» هرگز ساخته نمی‌شود', () => {
    expect(formatRial('0')).toBe('۰');
    expect(formatWeightMg('0')).toBe('۰٫۰۰۰');
    expect(formatIntegerString('0')).toBe('۰');
  });

  it('حاصل صفرِ جمع یا تفریق canonical «0» است، نه «-0»، و بی‌علامت نمایش داده می‌شود', () => {
    fc.assert(
      fc.property(anyBigInt, (value) => {
        const s = value.toString();
        const zeroSum = addBigIntStrings(s, (-value).toString());
        const zeroDiff = subtractBigIntStrings(s, s);
        return (
          zeroSum === '0' &&
          zeroDiff === '0' &&
          formatRial(zeroSum) === '۰' &&
          formatWeightMg(zeroDiff) === '۰٫۰۰۰'
        );
      }),
    );
  });

  it('صفر با هر مقدار دیگر درست مقایسه می‌شود', () => {
    fc.assert(
      fc.property(
        anyBigInt,
        (value) =>
          compareBigIntStrings('0', value.toString()) === (value > 0n ? -1 : value < 0n ? 1 : 0),
      ),
    );
  });
});
