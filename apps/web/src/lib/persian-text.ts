import { normalizePersian, searchKey } from '@gold/core-calc';
import { z } from 'zod';

/**
 * آینه‌ی `apps/api/src/shared/validation/persian-text.ts` (BE-016) — همان
 * قاعده، همان استثنا. فقط فیلدهای متنی انسانی (نام، یادداشت، موبایل
 * نمایشی) باید این‌ها را صدا بزنند؛ کد کالا، ایمیل، رمز و شناسه هرگز —
 * استفاده‌ی سراسری این‌ها را بی‌صدا تغییر می‌دهد.
 *
 * برای مبلغ و وزن این‌جا لازم نیست: `parseBigIntString` در `lib/bigint.ts`
 * از قبل ارقام را پیش از اعتبارسنجی نرمال می‌کند (FE-010).
 */

export function normalizeTextForStorage(value: string): string {
  return normalizePersian(value);
}

/** کلید جست‌وجوی متنی با همان قرارداد ذخیره‌سازی. */
export function normalizeTextForSearch(value: string): string {
  return searchKey(value);
}

/**
 * schema رشته‌ای را طوری می‌پیچد که مقدار **پیش از** رسیدن به schema اصلی
 * نرمال شود — دقیقاً همان قاعده‌ای که
 * `packages/contracts/src/common/bigint-string.ts` برای پول و وزن مستند
 * کرده: نرمال‌سازی وظیفه‌ی لایه‌ی ورودی است، نه خود schema. یعنی
 * `displayNameSchema`/`mobileSchema` در `@gold/contracts` هرگز لازم نیست
 * به ارقام فارسی یا ي/ك عربی فکر کنند.
 */
export function normalizedInput<T extends z.ZodTypeAny>(
  schema: T,
): z.ZodEffects<T, z.output<T>, unknown> {
  return z.preprocess(
    (value) => (typeof value === 'string' ? normalizeTextForStorage(value) : value),
    schema,
  );
}
