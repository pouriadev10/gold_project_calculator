/** نام هدر پاسخ برای پیگیری یک درخواست میان کاربر و لاگ سرور. */
export const REQUEST_ID_HEADER = 'x-request-id';

interface RequestIdCarrier {
  readonly requestId?: unknown;
  readonly raw?: RequestIdCarrier;
}

/**
 * Fastify در filter شیء request خودش را می‌دهد، اما middleware به raw request
 * دسترسی دارد. هر دو شکل را می‌خوانیم تا یک شناسه در تمام مسیر خطا حفظ شود.
 */
export function readRequestId(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null) {
    return undefined;
  }

  const carrier = request as RequestIdCarrier;

  if (typeof carrier.requestId === 'string' && carrier.requestId !== '') {
    return carrier.requestId;
  }

  return typeof carrier.raw?.requestId === 'string' && carrier.raw.requestId !== ''
    ? carrier.raw.requestId
    : undefined;
}
