import type { z } from 'zod';
import { apiErrorSchema } from './contracts';
import { ApiError, NetworkError } from './api-error';

export { ApiError, NetworkError };

/**
 * لایه‌ی دسترسی به API.
 *
 * چند کار انجام می‌دهد که اگر به عهده‌ی صفحات گذاشته شوند، دیر یا زود
 * یکی‌شان فراموش می‌شود:
 *
 * ۱. **`Idempotency-Key` روی هر نوشتن.** بخش ۵ `CLAUDE.md` این را اجباری
 *    کرده. کاربر در پاساژ با اینترنت ضعیف کار می‌کند؛ اگر پاسخ گم شود و
 *    دکمه دوباره زده شود، نباید فاکتور دوم ثبت گردد. کلید اینجا ساخته
 *    می‌شود، نه در صفحه — تا هیچ endpoint نوشتنی بدون آن نماند.
 *
 * ۲. **اعتبارسنجی پاسخ با `zod`.** پاسخ ناسازگار همین‌جا خطا می‌دهد،
 *    نه سه لایه بالاتر وسط رندر.
 *
 * ۳. **سقف زمان و لغو.** شبکه‌ی پاساژ بازار قطعاً یک‌جایی آویزان می‌ماند؛
 *    بدون سقف، یک fetch فراموش‌شده تا ابد کاربر را در حالت loading نگه
 *    می‌دارد.
 *
 * ۴. **شناسه‌ی رهگیری روی هر درخواست.** برای وصل‌کردن لاگ کلاینت به لاگ
 *    سروری که همین `requestId` را در بدنه‌ی خطا برمی‌گرداند.
 *
 * `no-restricted-globals` در `eslint.config.js` استفاده‌ی مستقیم `fetch`
 * را بیرون از همین پوشه (`api/`) خطا می‌دهد — هر Feature باید از این‌جا
 * عبور کند.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

/** سقف زمان یک درخواست. شبکه‌ی پاساژ کند است، ولی منتظر ماندن بی‌نهایت بدتر است. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * تولید شناسه‌ی یکتا — هم برای `Idempotency-Key` هم برای `X-Request-Id`.
 *
 * `crypto.randomUUID` در همه‌ی مرورگرهای هدف موجود است، ولی فقط در
 * زمینه‌ی امن (https یا localhost). جایگزین برای زمینه‌ی ناامن لازم است
 * وگرنه ثبت فاکتور روی http داخلی مغازه می‌شکند.
 */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * کلید یکتا برای هر تلاش نوشتن.
 *
 * اگر فراخوان کلید خودش را بدهد (برای تلاش مجدد **همان** عملیات)، همان
 * استفاده می‌شود. تلاش مجدد با کلید تازه یعنی عملیات جدید، نه تکرار.
 */
export function newIdempotencyKey(): string {
  return generateUuid();
}

/**
 * شناسه‌ی رهگیری یک درخواست — روی **هر** درخواست (خواندن یا نوشتن) تازه
 * ساخته می‌شود، برخلاف Idempotency-Key که فراخوان ممکن است نگه دارد.
 * هدفش یکی‌کردن سند نیست؛ فقط پیداکردن این درخواست در لاگ سرور است.
 */
function newRequestId(): string {
  return generateUuid();
}

/**
 * دو `AbortSignal` را در یکی ترکیب می‌کند — هرکدام زودتر لغو شود، نتیجه
 * هم لغو می‌شود.
 *
 * عمداً دستی نوشته شده به‌جای `AbortSignal.any`: آن متد به‌قدر کافی روی
 * WebView اندروید میان‌رده‌ی قدیمی پشتیبانی نمی‌شود — بخش ۷ CLAUDE.md
 * صریحاً می‌گوید تست روی دستگاه واقعی لازم است، نه فقط مرورگر توسعه‌ی جدید.
 */
function combineSignals(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason as unknown);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason as unknown), {
      once: true,
    });
  }

  return controller.signal;
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
  callerSignal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<z.infer<S>> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = combineSignals([callerSignal, timeoutSignal]);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal,
      headers: { Accept: 'application/json', 'X-Request-Id': newRequestId(), ...init.headers },
    });
  } catch (error) {
    /*
     * لغو عمدی فراخوان (مثلاً TanStack Query هنگام unmount یا جایگزینی
     * query) باید همان AbortError دست‌نخورده بالا برود — TanStack Query
     * با بررسی `error.name === 'AbortError'` این حالت را «لغو» می‌شناسد،
     * نه «خطا»؛ اگر اینجا در NetworkError بپیچیمش، آن تشخیص از کار می‌افتد
     * و لغوهای عادی مثل خطای شبکه‌ی واقعی نمایش داده می‌شوند.
     */
    if (callerSignal?.aborted) throw error;
    if (timeoutSignal.aborted) {
      throw new NetworkError('درخواست بیش از حد معمول طول کشید — دوباره تلاش کنید');
    }
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

/**
 * `timeoutMs` پیش‌فرض مناسب اکثر endpointهاست؛ فقط برای موارد شناخته‌شده
 * (جست‌وجوی نوع‌به‌نوع، تولید PDF) لازم است بازنویسی شود.
 */
export function apiGet<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<z.infer<S>> {
  return request(path, schema, { method: 'GET' }, signal, timeoutMs);
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
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<z.infer<S>> {
  return request(
    path,
    schema,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    signal,
    timeoutMs,
  );
}
