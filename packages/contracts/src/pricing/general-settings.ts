import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/index.js';

/**
 * تنظیمات عمومی مستأجر — FE-080.
 *
 * فقط شش کلید نسخه‌داری که صفحه‌ی تنظیمات عمومی ویرایش می‌کند. هر تغییر یک
 * نسخه‌ی تازه در `versioned_settings` می‌سازد (`VersionedSettingsService`)؛
 * نسخه‌ی قبلی با `valid_to` بسته می‌شود و هرگز overwrite نمی‌شود، پس سندهای
 * گذشته با snapshot خودشان همان اعداد را بازتولید می‌کنند (قاعده‌ی ۲-۶).
 *
 * مقدارها روی سیم رشته‌اند، همان شکل `valueJson.value` در دیتابیس، تا هیچ
 * عدد صنفی از `number` جاوااسکریپت رد نشود.
 */
export const generalSettingKeySchema = z.enum([
  'purchase.second_hand_default_karat',
  'pricing.rial_rounding_unit',
  'pricing.rounding_policy',
  'reporting.default_display_karat',
  'sales.invoice_correction_window_minutes',
  'sales.manager_approval_variance_rial',
]);
export type GeneralSettingKey = z.infer<typeof generalSettingKeySchema>;

/** تنها سیاستی که موتور قیمت‌گذاری می‌پذیرد (`roundHalfUp`، قاعده‌ی ۳ CLAUDE.md). */
export const roundingPolicySchema = z.enum(['HALF_UP']);

const DIGITS = /^\d+$/u;
/** سقف عملی پنجره‌ی اصلاح: یک سال. فراتر از آن عملاً «همیشه» است و نشانه‌ی خطای ورود. */
export const MAX_CORRECTION_WINDOW_MINUTES = 525_600n;
/** سقف ارقام ریال — هم‌خوان با bigint دیتابیس، بدون شناور. */
const MAX_RIAL_DIGITS = 18;

/**
 * اعتبارسنجی مقدار هر کلید — دقیقاً همان قاعده‌ای که سرویس‌های مصرف‌کننده
 * هنگام خواندن اعمال می‌کنند، تا مقداری ذخیره نشود که بعداً فروش یا خرید را
 * با خطای «تنظیم نامعتبر» متوقف کند. پیام خطا یا `null`.
 */
export function generalSettingValueError(key: GeneralSettingKey, value: string): string | null {
  switch (key) {
    case 'purchase.second_hand_default_karat':
    case 'reporting.default_display_karat': {
      if (!DIGITS.test(value)) return 'عیار باید عدد صحیح باشد';
      const karat = BigInt(value);
      return karat >= 1n && karat <= 1000n ? null : 'عیار باید بین ۱ و ۱۰۰۰ باشد';
    }
    case 'pricing.rial_rounding_unit':
      if (!DIGITS.test(value) || value.length > MAX_RIAL_DIGITS) return 'واحد گرد کردن باید عدد صحیح ریالی باشد';
      return BigInt(value) > 0n ? null : 'واحد گرد کردن باید بزرگ‌تر از صفر باشد';
    case 'pricing.rounding_policy':
      return roundingPolicySchema.safeParse(value).success ? null : 'سیاست گرد کردن پشتیبانی نمی‌شود';
    case 'sales.invoice_correction_window_minutes':
      if (!DIGITS.test(value)) return 'پنجره اصلاح باید عدد صحیح دقیقه باشد';
      return BigInt(value) <= MAX_CORRECTION_WINDOW_MINUTES ? null : 'پنجره اصلاح حداکثر یک سال است';
    case 'sales.manager_approval_variance_rial':
      return DIGITS.test(value) && value.length <= MAX_RIAL_DIGITS
        ? null
        : 'حد اختلاف باید عدد صحیح ریالی و نامنفی باشد';
  }
}

export const generalSettingSchema = z.object({
  key: generalSettingKeySchema,
  value: z.string(),
  /** شماره‌ی نسخه‌ی مؤثر فعلی. */
  version: z.number().int().positive(),
  /** شروع اعتبار نسخه‌ی فعلی. */
  validFrom: isoDateTimeSchema,
  createdBy: uuidSchema.nullable(),
});

export const generalSettingsSchema = z.object({
  settings: z.array(generalSettingSchema),
});

/**
 * مقدار عددی به شکل متعارف ذخیره می‌شود: «01000» ← «1000» (M-13). فروش و خرید همین رشته را در
 * snapshot ِ سند قفل می‌کنند و خواندن snapshot فقط شکل متعارف را می‌پذیرد؛ بدون این، فاکتور
 * درست قیمت می‌خورد ولی جزئیاتش واحد گرد کردن را «نامعلوم» نشان می‌داد.
 */
function canonicalGeneralSettingValue(key: GeneralSettingKey, value: string): string {
  return key !== 'pricing.rounding_policy' && DIGITS.test(value) ? BigInt(value).toString() : value;
}

/** ساخت نسخه‌ی تازه‌ی یک کلید؛ زمان شروع اعتبار را سرور تعیین می‌کند (اکنون). */
export const updateGeneralSettingSchema = z
  .object({
    key: generalSettingKeySchema,
    value: z.string().trim().min(1, 'مقدار الزامی است'),
  })
  .strict()
  .superRefine((input, context) => {
    const error = generalSettingValueError(input.key, input.value);
    if (error !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: error });
  })
  .transform((input) => ({ ...input, value: canonicalGeneralSettingValue(input.key, input.value) }));

export type GeneralSetting = z.infer<typeof generalSettingSchema>;
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
export type UpdateGeneralSettingInput = z.infer<typeof updateGeneralSettingSchema>;
