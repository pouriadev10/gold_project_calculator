import { z } from 'zod';

/**
 * قرارداد یکسان خطا برای همه‌ی endpointها — شکل نهایی در BE-017 پیاده می‌شود.
 *
 * پوسته‌ی `error` عمدی است: پاسخ موفق هرگز کلید `error` ندارد، پس کلاینت
 * بدون نگاه به کد وضعیت هم می‌تواند تشخیص بدهد چه گرفته است.
 */

/** کد ماشین‌خوان مثل `PARTY_NOT_FOUND`. پیام برای انسان است، کد برای کلاینت. */
export const apiErrorCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, 'کد خطا باید SCREAMING_SNAKE_CASE باشد');

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    /** پیام فارسیِ قابل نمایش به کاربر. هرگز شامل جزئیات schema دیتابیس نیست. */
    message: z.string().min(1),
    /** خطای هر فیلد فرم؛ برای خطاهای غیرِ اعتبارسنجی خالی می‌ماند. */
    fields: z.record(z.string(), z.array(z.string())).default({}),
    /** همان شناسه‌ای که در log سرور ثبت شده — پل میان گزارش کاربر و لاگ. */
    requestId: z.string().min(1),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
