import type { z } from 'zod';
import { apiErrorSchema } from './contracts';

/**
 * لایه‌ی دسترسی به API.
 *
 * دو کار انجام می‌دهد که اگر به عهده‌ی صفحات گذاشته شوند، دیر یا زود
 * یکی‌شان فراموش می‌شود:
 *
 * ۱. **`Idempotency-Key` روی هر نوشتن.** بخش ۵ `CLAUDE.md` این را اجباری
 *    کرده. کاربر در پاساژ با اینترنت ضعیف کار می‌کند؛ اگر پاسخ گم شود و
 *    دکمه دوباره زده شود، نباید فاکتور دوم ثبت گردد. کلید اینجا ساخته
 *    می‌شود، نه در صفحه — تا هیچ endpoint نوشتنی بدون آن نماند.
 *
 * ۲. **اعتبارسنجی پاسخ با `zod`.** پاسخ ناسازگار همین‌جا خطا می‌دهد،
 *    نه سه لایه بالاتر وسط رندر.
 */

const BASE_URL = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** خطای هر فیلد فرم — کلید نام فیلد، مقدار فهرست پیام‌ها. برای خطای غیر-اعتبارسنجی خالی است. */
  readonly fields: Record<string, string[]>;
  /** همان شناسه‌ای که در log سرور ثبت شده. خطاهای ساخته‌شده سمت کلاینت (شبکه، SCHEMA_MISMATCH) شناسه ندارند. */
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string[]> = {},
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.requestId = requestId;
  }
}

/** خطای شبکه یا پاسخ نامعتبر — پیام فارسی برای نمایش مستقیم به کاربر. */
export class NetworkError extends Error {
  constructor(message = 'ارتباط با سرور برقرار نشد') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * کلید یکتا برای هر تلاش نوشتن.
 *
 * `crypto.randomUUID` در همه‌ی مرورگرهای هدف موجود است، ولی فقط در
 * زمینه‌ی امن (https یا localhost). جایگزین برای زمینه‌ی ناامن لازم است
 * وگرنه ثبت فاکتور روی http داخلی مغازه می‌شکند.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function parseError(response: Response): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, 'UNKNOWN', 'پاسخ سرور قابل خواندن نبود');
  }

  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, fields, requestId } = parsed.data.error;
    throw new ApiError(response.status, code, message, fields, requestId);
  }

  throw new ApiError(response.status, 'UNKNOWN', 'خطای ناشناخته از سرور');
}

/**
 * جنریک روی **خود اسکیما** است، نه روی نوع خروجی.
 *
 * اسکیماهای ما `.transform()` دارند (رشته روی سیم → `bigint` در برنامه)،
 * پس ورودی و خروجی‌شان یکی نیست و `ZodType<T>` نمی‌تواند توصیفشان کند.
 * `z.infer<S>` نوع **پس از تبدیل** را می‌دهد — همان چیزی که صفحه می‌گیرد.
 */
async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new NetworkError();
  }

  if (!response.ok) await parseError(response);

  const body: unknown = await response.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    // ناسازگاری schema یک باگ کد است، نه یک خطای کاربر — باید فوراً در کنسول دیده شود
    console.error('پاسخ سرور با قرارداد نمی‌خواند:', path, parsed.error.issues);
    throw new ApiError(response.status, 'SCHEMA_MISMATCH', 'پاسخ سرور با قرارداد نمی‌خواند');
  }

  return parsed.data;
}

export function apiGet<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  return request(path, schema, signal ? { method: 'GET', signal } : { method: 'GET' });
}

/**
 * نوشتن — `Idempotency-Key` خودکار اضافه می‌شود.
 *
 * اگر فراخوان کلید خودش را بدهد (برای تلاش مجدد **همان** عملیات)، همان
 * استفاده می‌شود. تلاش مجدد با کلید تازه یعنی عملیات جدید، نه تکرار.
 */
export function apiPost<S extends z.ZodTypeAny>(
  path: string,
  body: unknown,
  schema: S,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<z.infer<S>> {
  return request(path, schema, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}
