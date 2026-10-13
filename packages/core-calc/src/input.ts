/**
 * بافر ورودی عددی — پایه‌ی صفحه‌کلید سفارشی.
 *
 * ## چرا رشته، نه عدد
 *
 * مقدار در حال تایپ **رشته‌ی ارقام** است، نه عدد. دلیلش سه چیز است:
 *
 * ۱. حالت‌های میانی عدد معتبر نیستند ولی باید نمایش داده شوند: `"12."`
 *    یا `"0.0"` — اگر به عدد تبدیل شوند، جداکننده یا صفرهای انتهایی
 *    ناپدید می‌شوند و مکان‌نما می‌پرد.
 * ۲. `"0.1" + "2"` روی رشته یعنی `"0.12"`. روی float یعنی حدس زدن.
 * ۳. تبدیل نهایی رقم‌به‌رقم انجام می‌شود و **هیچ‌جا از float عبور نمی‌کند** —
 *    قاعده‌ی ۱ BOOTSTRAP.
 *
 * همه‌ی توابع اینجا خالص‌اند: رشته می‌گیرند، رشته می‌دهند.
 */

import { toLatinDigits } from './persian.js';
import { CalcError } from './types.js';

/** جداکننده‌ی اعشار **داخلی**. نمایش فارسی جداگانه انجام می‌شود. */
export const DECIMAL_MARK = '.';

export interface DigitSpec {
  /** ارقام اعشار مجاز — وزن ۳ (میلی‌گرم)، بقیه ۰ */
  readonly decimals: number;
  /** بیشینه‌ی ارقام بخش صحیح — جلوی ورودی بی‌معنا را می‌گیرد */
  readonly maxIntegerDigits: number;
}

/**
 * مشخصات هر نوع فیلد.
 *
 * این‌ها **محدودیت ورودی** هستند، نه عدد صنفی: عیار واقعی از دیتابیس
 * می‌آید؛ اینجا فقط می‌گوییم بیش از ۴ رقم نمی‌شود تایپ کرد.
 */
export const DIGIT_SPECS = {
  /** گرم با سه رقم اعشار → میلی‌گرم */
  weight: { decimals: 3, maxIntegerDigits: 6 },
  /**
   * وزن مرجع نوع سکه: گرم با شش رقم اعشار → میکروگرم (`grossWeightUg`).
   * فقط برای مشخصات نوع سکه، تا وزن رسمی مثل ۴٫۰۶۶۵ گرم گرد نشود.
   */
  coinWeight: { decimals: 6, maxIntegerDigits: 3 },
  /** عیار صحیح */
  karat: { decimals: 0, maxIntegerDigits: 4 },
  /** ریال — بدون اعشار */
  rial: { decimals: 0, maxIntegerDigits: 15 },
  /** تعداد سکه یا قلم */
  count: { decimals: 0, maxIntegerDigits: 6 },
  /** مظنه — ریال */
  mazneh: { decimals: 0, maxIntegerDigits: 15 },
  /** درصد با دو رقم اعشار → مقیاس ×۱۰۰ صحیح (۷٫۵٪ → ۷۵۰) — قرارداد `PERCENT_X100` */
  percent: { decimals: 2, maxIntegerDigits: 3 },
} as const satisfies Record<string, DigitSpec>;

export type NumericFieldKind = keyof typeof DIGIT_SPECS;

const DIGITS = new Set('0123456789');

function splitBuffer(raw: string): { integer: string; fraction: string; hasMark: boolean } {
  const index = raw.indexOf(DECIMAL_MARK);
  if (index === -1) return { integer: raw, fraction: '', hasMark: false };
  return { integer: raw.slice(0, index), fraction: raw.slice(index + 1), hasMark: true };
}

/**
 * افزودن یک رقم.
 *
 * اگر ظرفیت پر باشد بافر **بدون تغییر** برمی‌گردد — ضربه بی‌اثر است،
 * نه اینکه رقم را از جای دیگری بیندازد.
 */
export function pushDigit(raw: string, digit: string, spec: DigitSpec): string {
  if (!DIGITS.has(digit) || digit.length !== 1) {
    throw new CalcError(`ورودی «${digit}» رقم نیست`);
  }

  const { integer, fraction, hasMark } = splitBuffer(raw);

  if (hasMark) {
    if (fraction.length >= spec.decimals) return raw;
    return raw + digit;
  }

  if (integer.length >= spec.maxIntegerDigits) return raw;
  // صفر پیشوند معنا ندارد: «۰» سپس «۵» باید «۵» شود، نه «۰۵»
  if (integer === '0') return digit;
  return raw + digit;
}

/**
 * افزودن جداکننده‌ی اعشار.
 *
 * روی فیلدهای بدون اعشار (عیار، ریال، تعداد) بی‌اثر است — کلید `٫` روی
 * آن فیلدها اصلاً نباید فعال باشد، ولی اگر شد، خرابی به بار نمی‌آورد.
 */
export function pushSeparator(raw: string, spec: DigitSpec): string {
  if (spec.decimals === 0) return raw;
  if (raw.includes(DECIMAL_MARK)) return raw;
  if (raw === '') return `0${DECIMAL_MARK}`;
  return raw + DECIMAL_MARK;
}

/** حذف آخرین نویسه. */
export function popDigit(raw: string): string {
  return raw.slice(0, -1);
}

/** پاک‌کردن کامل — رفتار نگه‌داشتن `⌫`. */
export function clearDigits(): string {
  return '';
}

/**
 * رشته → `bigint` در واحد پایه (میلی‌گرم برای وزن، ریال برای مبلغ).
 *
 * تبدیل رقم‌به‌رقم است: بخش اعشار تا `decimals` با صفر پر یا بریده
 * می‌شود و سپس کل رشته به `BigInt` داده می‌شود. **هیچ ضرب یا تقسیم
 * شناوری در مسیر نیست.**
 */
export function digitsToBigInt(raw: string, spec: DigitSpec): bigint {
  if (raw === '' || raw === DECIMAL_MARK) return 0n;

  const { integer, fraction } = splitBuffer(raw);
  const paddedFraction = (fraction + '0'.repeat(spec.decimals)).slice(0, spec.decimals);
  const combined = (integer === '' ? '0' : integer) + paddedFraction;

  return BigInt(combined);
}

/** `bigint` → رشته‌ی قابل ویرایش. برای پرکردن اولیه‌ی فیلد. */
export function bigIntToDigits(value: bigint, spec: DigitSpec): string {
  if (value < 0n) throw new CalcError('بافر ورودی مقدار منفی نمی‌پذیرد');

  if (spec.decimals === 0) return value === 0n ? '' : value.toString();

  const unit = 10n ** BigInt(spec.decimals);
  const integer = value / unit;
  const fraction = value % unit;

  if (fraction === 0n) return integer === 0n && value === 0n ? '' : integer.toString();

  // (frac + unit) صفر پیشوند را تضمین می‌کند؛ slice(1) رقم اضافه را برمی‌دارد
  const padded = (fraction + unit).toString().slice(1).replace(/0+$/u, '');
  return `${integer}${DECIMAL_MARK}${padded}`;
}

/** جداکننده‌ی اعشار فارسی/عربی — کاربر ممکن است متن چسبانده‌شده با همین نویسه داشته باشد. */
const ARABIC_DECIMAL_SEPARATOR = '٫';

/**
 * نویسه‌هایی که در متن چسبانده‌شده جداکننده‌ی اعشارند — همان‌هایی که کیبورد فیزیکی
 * کیپد هم اعشار می‌گیرد (`.` و `/` که فارسی‌نویس‌ها «۲/۵» می‌نویسند) به‌علاوه‌ی `٫`.
 */
const PASTE_DECIMAL_MARKS = new Set([DECIMAL_MARK, ARABIC_DECIMAL_SEPARATOR, '/']);

/** علامت منفی — خط تیره یا منفی تایپوگرافیک. فیلدهای ورودی مقدار منفی ندارند. */
const MINUS_SIGNS = new Set(['-', '\u2212']);

/**
 * متن چسبانده‌شده (paste) → بافر — **فقط اگر فیلد دقیقاً همان عدد را نگه دارد** (FE-092).
 *
 * چسباندن یعنی «مقدار تازه»، نه ادامه‌ی بافر قبلی. جداساز هزارگان (`,` `٬`)، فاصله و متن
 * واحد («ریال»، «گرم») نادیده گرفته می‌شوند. ولی هر چیزی که عدد را عوض می‌کند، به‌جای حدس
 * زدن، کل چسباندن را رد می‌کند و بافر خالی برمی‌گرداند — همان رفتار متن غیرعددی:
 *
 * - اعشار ناصفر روی فیلد بی‌اعشار: «۱۲۵۰۰٫۷۵» ریال قبلاً ۱٬۲۵۰٬۰۷۵ می‌شد (ارقام به هم می‌چسبیدند)؛
 * - ارقام اعشار بیش از ظرفیت (وزن «۱٫۲۳۴۵۶» گرم قبلاً بی‌صدا ۱٫۲۳۴ می‌شد)؛
 * - ارقام صحیح بیش از ظرفیت (۳۰ رقم قبلاً به ۱۵ رقم اول بریده می‌شد)؛
 * - علامت منفی («-۵۰۰» قبلاً ۵۰۰ می‌شد)؛
 * - بیش از یک جداکننده‌ی اعشار («۱۲.۵۰۰.۰۰۰» — هزارگان یا اعشار؟ مبهم).
 *
 * صفرهای اضافه‌ی انتهای اعشار عدد را عوض نمی‌کنند و پذیرفته‌اند («۱۲۵۰۰٫۰۰» ریال، «۱٫۲۳۴۰» گرم).
 * بافر نهایی از همان مسیر `pushDigit`/`pushSeparator` تایپ ساخته می‌شود، پس شکلش (صفر پیشوند،
 * «۰٫») عیناً شکل تایپ همان عدد است.
 */
export function pasteDigits(text: string, spec: DigitSpec): string {
  const latin = toLatinDigits(text);
  let integer = '';
  let fraction = '';
  let marks = 0;

  for (const ch of latin) {
    if (DIGITS.has(ch)) {
      if (marks === 0) integer += ch;
      else fraction += ch;
    } else if (PASTE_DECIMAL_MARKS.has(ch)) {
      marks += 1;
    } else if (MINUS_SIGNS.has(ch)) {
      return '';
    }
  }

  if (marks > 1) return '';
  const significantInteger = integer.replace(/^0+/u, '');
  const significantFraction = fraction.replace(/0+$/u, '');
  if (significantInteger.length > spec.maxIntegerDigits) return '';
  if (significantFraction.length > spec.decimals) return '';

  let buffer = '';
  for (const digit of significantInteger || (integer ? '0' : '')) buffer = pushDigit(buffer, digit, spec);
  if (marks === 1 && spec.decimals > 0) {
    buffer = pushSeparator(buffer, spec);
    for (const digit of fraction.slice(0, spec.decimals)) buffer = pushDigit(buffer, digit, spec);
  }
  return buffer;
}

/** آیا بافر مقدار معناداری دارد؟ `"0."` هنوز خالی حساب می‌شود. */
export function isBlank(raw: string): boolean {
  return digitsToBigInt(raw, { decimals: 9, maxIntegerDigits: 30 }) === 0n;
}
