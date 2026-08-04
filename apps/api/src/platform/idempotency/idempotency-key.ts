import {
  InvalidIdempotencyKeyError,
  MissingIdempotencyKeyError,
} from './idempotency.errors';

/** نام استاندارد هدر در Node همواره lowercase خوانده می‌شود. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * سقف زیرساختی برای جلوگیری از ذخیره‌ی هدر بی‌نهایت؛ عدد صنفی نیست.
 * UUID، ULID و کلیدهای تصادفی متداول بسیار کوتاه‌تر از این سقف هستند.
 */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

type HeaderValue = readonly string[] | string | undefined;

/**
 * کلید را از هدرها می‌خواند. هدر تکراری مبهم است، پس به‌جای انتخاب یکی از
 * آن‌ها رد می‌شود.
 */
export function readIdempotencyKey(headers: Record<string, HeaderValue>): string | undefined {
  const value = headers[IDEMPOTENCY_KEY_HEADER];

  if (value !== undefined && typeof value !== 'string') {
    throw new InvalidIdempotencyKeyError();
  }

  return value;
}

/** اعتبارسنجی مشترک middleware و service. */
export function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();

  if (key === undefined || key === '') {
    throw new MissingIdempotencyKeyError();
  }

  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new InvalidIdempotencyKeyError();
  }

  return key;
}
