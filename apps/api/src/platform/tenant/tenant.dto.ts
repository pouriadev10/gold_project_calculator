import { z } from 'zod';
import { normalizeTextForStorage } from '../../shared/validation';

/**
 * قرارداد ورودی endpointهای موقت توسعه.
 *
 * عمداً در `packages/contracts` نیست: آن پکیج قرارداد **مشترک فرانت و
 * بک‌اند** است، و این endpointها فقط ابزار توسعه‌اند و در production
 * اصلاً وجود ندارند. گذاشتنشان در قرارداد عمومی یعنی وعده‌ی چیزی که
 * قرار نیست بماند.
 */

/**
 * slug باید در URL و نام پایگاه‌داده‌ی گزارش‌ها بی‌دردسر باشد: فقط حروف
 * کوچک لاتین، رقم، و خط تیره‌ی میانی. نه خط تیره‌ی ابتدا/انتها، نه دوتایی.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_NAME_LENGTH = 200;
const MAX_SLUG_LENGTH = 64;
const MAX_TIMEZONE_LENGTH = 64;

export const TIME_ZONE_MESSAGE = 'منطقه‌ی زمانی باید نام IANA معتبر باشد (مثل Asia/Tehran)، نه آفست';

/**
 * منطقه‌ی زمانی باید واقعاً یک شناسه‌ی IANA معتبر باشد.
 *
 * ذخیره‌ی یک مقدار بی‌معنا اینجا بی‌سروصداست، ولی بعداً موقع تبدیل به
 * تقویم جلالی یا تعیین «روز کاری» یک فاکتور می‌ترکد — جایی که تشخیص
 * علتش خیلی سخت‌تر است. `Intl` تنها منبع حقیقتی است که خودِ runtime دارد.
 */
export function canonicalTimeZone(value: string): string | undefined {
  /*
   * آفست خام («+03:30»، «-05»، «UTC+3») رد می‌شود (M-06): V8 آن را می‌پذیرد و شرق UTC
   * می‌خواند، ولی `AT TIME ZONE` ِ PostgreSQL همان رشته را POSIX و **غرب** UTC می‌خواند —
   * مرز روز و سال جلالی در JS و SQL هفت ساعت از هم فاصله می‌گرفت.
   */
  if (/^[+-]|:|^(?:utc|gmt)[+-]/iu.test(value)) {
    return undefined;
  }
  try {
    // شکل متعارف ICU: «asia/tehran» و «Iran» هر دو «Asia/Tehran» ذخیره می‌شوند.
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export const createTenantSchema = z.object({
  name: z
    .string()
    .transform(normalizeTextForStorage)
    .pipe(z.string().min(1, 'نام الزامی است').max(MAX_NAME_LENGTH)),
  slug: z
    .string()
    .trim()
    .min(2, 'شناسه حداقل دو کاراکتر است')
    .max(MAX_SLUG_LENGTH)
    .regex(SLUG_PATTERN, 'شناسه فقط حروف کوچک لاتین، رقم و خط تیره‌ی میانی می‌پذیرد'),
  /*
   * اختیاری است و در نبودش **مقدار پیش‌فرض ستون دیتابیس** اعمال می‌شود،
   * نه یک fallback در کد — قاعده‌ی BE-007.
   */
  timezone: z
    .string()
    .trim()
    .max(MAX_TIMEZONE_LENGTH)
    .transform((value, context) => {
      const canonical = canonicalTimeZone(value);
      if (canonical === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: TIME_ZONE_MESSAGE });
        return z.NEVER;
      }
      return canonical;
    })
    .optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
