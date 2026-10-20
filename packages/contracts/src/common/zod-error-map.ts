import { z } from 'zod';

/**
 * پیام‌های فارسی برای خطاهای **پیش‌فرض** Zod — M-04.
 *
 * پیام‌هایی که خود schema دارد (`.min(1, 'عنوان الزامی است')`) همیشه برنده‌اند؛ این
 * نقشه فقط جای پیام‌های انگلیسی پیش‌فرض را می‌گیرد («Required»، «Invalid datetime»،
 * «Expected number, received string»، «Unrecognized key(s) in object»). بدون آن،
 * پاسخ ۴۰۰ ِ API متن انگلیسی به کاربر فارسی‌زبان می‌داد.
 *
 * سراسری (`z.setErrorMap`) نصب نمی‌شود: فراخوان آن را به `safeParse(value, { errorMap })`
 * می‌دهد، پس هیچ import ای رفتار Zod ِ بقیه‌ی برنامه را بی‌صدا عوض نمی‌کند.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function persianDigits(value: number | bigint | string): string {
  return String(value).replace(/[0-9]/gu, (digit) => PERSIAN_DIGITS[digit.charCodeAt(0) - 48]!);
}

const STRING_FORMAT: Readonly<Record<string, string>> = {
  datetime: 'تاریخ و زمان باید ISO-8601 با منطقه‌ی زمانی باشد',
  uuid: 'شناسه باید UUID معتبر باشد',
  email: 'ایمیل معتبر نیست',
  regex: 'قالب مقدار نادرست است',
};

/** سقف بازتاب نام کلیدهای ناشناخته‌ی ورودی — مرز فنی، تا بدنه‌ی بدخواه پاسخ خطای غول‌آسا نسازد. */
const MAX_ECHOED_KEYS = 5;
const MAX_ECHOED_KEY_LENGTH = 40;

function echoedKeys(keys: readonly string[]): string {
  const shown = keys
    .slice(0, MAX_ECHOED_KEYS)
    .map((key) => (key.length > MAX_ECHOED_KEY_LENGTH ? `${key.slice(0, MAX_ECHOED_KEY_LENGTH)}…` : key));
  return keys.length > MAX_ECHOED_KEYS ? `${shown.join('، ')} و …` : shown.join('، ');
}

function sizeMessage(issue: z.ZodTooSmallIssue | z.ZodTooBigIssue): string {
  const small = issue.code === z.ZodIssueCode.too_small;
  const bound = persianDigits(small ? issue.minimum : issue.maximum);
  switch (issue.type) {
    case 'string':
      return small ? `حداقل ${bound} نویسه لازم است` : `حداکثر ${bound} نویسه مجاز است`;
    case 'array':
    case 'set':
      return small ? `حداقل ${bound} مورد لازم است` : `حداکثر ${bound} مورد مجاز است`;
    default:
      if (small) return issue.inclusive ? `باید حداقل ${bound} باشد` : `باید بزرگ‌تر از ${bound} باشد`;
      return issue.inclusive ? `باید حداکثر ${bound} باشد` : `باید کوچک‌تر از ${bound} باشد`;
  }
}

function issueMessage(issue: z.ZodIssueOptionalMessage): string {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return issue.received === z.ZodParsedType.undefined ? 'این فیلد الزامی است' : 'نوع مقدار نادرست است';
    case z.ZodIssueCode.unrecognized_keys:
      return `فیلد ناشناخته: ${echoedKeys(issue.keys)}`;
    case z.ZodIssueCode.invalid_string: {
      const format = typeof issue.validation === 'string' ? STRING_FORMAT[issue.validation] : undefined;
      return format ?? 'قالب مقدار نادرست است';
    }
    case z.ZodIssueCode.too_small:
    case z.ZodIssueCode.too_big:
      return sizeMessage(issue);
    case z.ZodIssueCode.invalid_enum_value:
      return `مقدار مجاز نیست؛ یکی از این‌ها باشد: ${issue.options.join('، ')}`;
    case z.ZodIssueCode.invalid_union_discriminator:
      return `نوع نامعتبر است؛ یکی از این‌ها باشد: ${issue.options.map(String).join('، ')}`;
    case z.ZodIssueCode.invalid_literal:
      return 'مقدار مجاز نیست';
    case z.ZodIssueCode.not_multiple_of:
      return `باید مضربی از ${persianDigits(String(issue.multipleOf))} باشد`;
    case z.ZodIssueCode.not_finite:
      return 'عدد باید متناهی باشد';
    case z.ZodIssueCode.invalid_date:
      return 'تاریخ نامعتبر است';
    default:
      return 'مقدار نامعتبر است';
  }
}

/** نقشه‌ی خطای Zod با پیام فارسی؛ پیام صریح schema را دست نمی‌زند. */
export const persianZodErrorMap: z.ZodErrorMap = (issue) => ({ message: issueMessage(issue) });
