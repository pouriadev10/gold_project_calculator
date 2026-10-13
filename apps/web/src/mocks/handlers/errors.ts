import { apiErrorSchema } from '@gold/contracts';
import { HttpResponse } from 'msw';
import type { ZodError } from 'zod';

/**
 * کدهای خطایی که سرور واقعاً می‌فرستد و وضعیت HTTP همراه هرکدام — آینه‌ی
 * `apps/api/src/platform/error-contract/api-exception.filter.ts`.
 *
 * mock حق ندارد کدی بسازد که سرور هرگز نمی‌فرستد (مثل `IDEMPOTENCY_KEY_REQUIRED`
 * یا وضعیت ۴۲۲ که پیش از FE-093 در mockها بود): آن‌وقت توسعه و تست روی رفتاری
 * سبز می‌شوند که production هیچ‌وقت نشان نمی‌دهد. `contract-conformance.test.ts`
 * همین فهرست را با متن filter سرور مقایسه می‌کند.
 */
export const MOCK_ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const satisfies Record<string, number>;

export type MockErrorCode = keyof typeof MOCK_ERROR_STATUS;

/**
 * پاسخ خطای ساختگی — FE-093. **تنها** راه ساختن پاسخ خطا در handlerهای MSW.
 *
 * بدنه با همان `apiErrorSchema` ِ `packages/contracts` ساخته و همان لحظه اعتبارسنجی می‌شود
 * (`parse`، نه `safeParse`): اگر قرارداد خطا عوض شود، هر mock خطا — و هر تستی که از آن
 * عبور می‌کند — فوراً می‌شکند، نه اینکه کلاینت بی‌صدا «خطای ناشناخته از سرور» نشان دهد.
 * وضعیت HTTP از کد مشتق می‌شود، پس جفت ناسازگار (`NOT_FOUND` با ۴۰۰) ساختنی نیست.
 */
export function mockError(
  code: MockErrorCode,
  message: string,
  fields: Readonly<Record<string, readonly string[]>> = {},
): Response {
  const body = apiErrorSchema.parse({
    error: {
      code,
      message,
      fields: Object.fromEntries(Object.entries(fields).map(([field, messages]) => [field, [...messages]])),
      requestId: crypto.randomUUID(),
    },
  });
  return HttpResponse.json(body, { status: MOCK_ERROR_STATUS[code] });
}

/**
 * پیام‌های zod به شکل `fields` ِ سرور — آینه‌ی `ZodValidationPipe`
 * (`apps/api/src/shared/validation`): `flatten().fieldErrors`، یعنی فقط کلید سطح اول
 * و بدون خطاهای ریشه؛ مقدار ارسالی هرگز در پیام تکرار نمی‌شود.
 */
export function zodFields(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(error.flatten().fieldErrors as Record<string, string[] | undefined>)) {
    if (messages !== undefined && messages.length > 0) fields[field] = messages;
  }
  return fields;
}

/** خطای اعتبارسنجی zod به شکل سرور: `400 VALIDATION_ERROR` «ورودی نامعتبر است» با پیام‌های هر فیلد. */
export function mockValidationError(error: ZodError): Response {
  return mockError('VALIDATION_ERROR', 'ورودی نامعتبر است', zodFields(error));
}

/** پیام سرور برای نبود هدر (`MissingIdempotencyKeyError` ← `BadRequestException` در middleware). */
export const MISSING_IDEMPOTENCY_KEY_MESSAGE = 'هدر Idempotency-Key برای عملیات نوشتنی الزامی است';

export function mockMissingIdempotencyKey(): Response {
  return mockError('BAD_REQUEST', MISSING_IDEMPOTENCY_KEY_MESSAGE);
}
