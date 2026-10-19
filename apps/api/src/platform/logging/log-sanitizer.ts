/**
 * پاک‌سازی داده پیش از نوشتن در log — BE-067.
 *
 * فرق با `sanitizeAuditData`: آن‌جا کلید حساس **حذف** می‌شود چون audit سند
 * کسب‌وکار است؛ این‌جا جایش `[REDACTED]` می‌نشیند تا کسی که log را می‌خواند
 * بفهمد فیلد وجود داشته و عمداً پنهان شده، نه اینکه هرگز ارسال نشده.
 */

export const REDACTED = '[REDACTED]';

const SECRET_KEY_PATTERN =
  /(?:api[-_]?key|authorization|cookie|credential|passw(?:or)?d|secret|token)/i;

/** `nationalId` در مدل طرف حساب؛ بقیه شکل‌هایی‌اند که ممکن است از ورودی یا خطا برسند. */
const NATIONAL_ID_KEY_PATTERN = /(?:national[-_]?(?:id|code)|melli)/i;

/**
 * چند رقم آخر کد ملی که در log می‌ماند. پارامتر حریم خصوصی است نه عدد صنفی؛
 * همان‌قدر که پشتیبانی بتواند دو مشتری را از هم تشخیص دهد و نه بیشتر.
 */
const VISIBLE_NATIONAL_ID_CHARS = 4;

const CIRCULAR_VALUE = '[circular]';
const UNSUPPORTED_VALUE = '[unsupported]';

export type LogValue =
  | null
  | boolean
  | number
  | string
  | readonly LogValue[]
  | { readonly [key: string]: LogValue };

/** کد ملی کامل هرگز log نمی‌شود؛ فقط چند نویسه‌ی آخرش برای تشخیص. */
export function maskNationalId(value: string): string {
  if (value.length <= VISIBLE_NATIONAL_ID_CHARS) {
    return '*'.repeat(value.length);
  }

  return `${'*'.repeat(value.length - VISIBLE_NATIONAL_ID_CHARS)}${value.slice(-VISIBLE_NATIONAL_ID_CHARS)}`;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function sanitizeNationalId(value: unknown): LogValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return maskNationalId(value.toString());
  }

  return REDACTED;
}

/**
 * هر مقداری را به شکل امن JSON برمی‌گرداند. `undefined` یعنی «فیلد را ننویس».
 *
 * - کلید شبیه رمز/توکن/کوکی در هر عمقی `[REDACTED]` می‌شود.
 * - کد ملی ماسک می‌شود.
 * - `bigint` رشته می‌شود — همان قرارداد JSON پول/وزن.
 * - `Error` فقط نامش را نگه می‌دارد: پیام خطای دیتابیس پارامترهای کوئری را
 *   دارد و ممکن است کد ملی یا هر داده‌ی ورودی دیگری را لو بدهد. stack فقط
 *   صریحاً و فقط بیرون از production فرستاده می‌شود.
 */
export function sanitizeLogData(value: unknown, seen = new WeakSet<object>()): LogValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return UNSUPPORTED_VALUE;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? UNSUPPORTED_VALUE : value.toISOString();
  }
  if (value instanceof Error) {
    return { name: value.name };
  }
  if (seen.has(value)) {
    return CIRCULAR_VALUE;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogData(item, seen) ?? null);
  }
  if (!isPlainRecord(value)) {
    return UNSUPPORTED_VALUE;
  }

  const sanitized: Record<string, LogValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      continue;
    }
    if (SECRET_KEY_PATTERN.test(key)) {
      sanitized[key] = REDACTED;
      continue;
    }
    if (NATIONAL_ID_KEY_PATTERN.test(key)) {
      sanitized[key] = sanitizeNationalId(item);
      continue;
    }

    const safeValue = sanitizeLogData(item, seen);
    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }

  return sanitized;
}

/** شکل مورد نیاز `formatters.log` در pino: همیشه یک شیء. */
export function sanitizeLogRecord(record: Record<string, unknown>): Record<string, LogValue> {
  const sanitized = sanitizeLogData(record);

  return typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized)
    ? (sanitized as Record<string, LogValue>)
    : {};
}
