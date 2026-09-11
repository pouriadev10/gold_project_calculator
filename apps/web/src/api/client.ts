import type { z } from 'zod';
import { useSessionStore } from '@/stores/session-store';
import { ApiError, NetworkError } from './api-error';
import { apiErrorSchema, sessionResponseSchema, type SessionResponse } from './contracts';

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
 * ۵. **هدر Authorization + تمدید خودکار (FE-027).** توکن دسترسی از
 *    `session-store` خوانده می‌شود. روی ۴۰۱، یک تمدید تلاش می‌شود؛ اگر
 *    موفق شد، خواندن‌ها (GET) بی‌صدا دوباره تلاش می‌شوند، ولی نوشتن‌ها
 *    خودکار دوباره ارسال **نمی‌شوند** — قاعده‌ی FE-027 برای مبالغ مالی.
 *    فراخوان با همان `Idempotency-Key` دوباره `submit` می‌کند (رابط
 *    کاربری این را با پیام روشن از او می‌خواهد).
 *
 * `no-restricted-globals` در `eslint.config.js` استفاده‌ی مستقیم `fetch`
 * را بیرون از همین پوشه (`api/`) خطا می‌دهد — هر Feature باید از این‌جا
 * عبور کند.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

/** سقف زمان یک درخواست. شبکه‌ی پاساژ کند است، ولی منتظر ماندن بی‌نهایت بدتر است. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * تولید شناسه‌ی یکتا — هم برای `Idempotency-Key` هم برای `X-Request-Id`،
 * هم (از `export`ش، FE-042) کلیدهای کاملاً محلی مثل `lineId` سبد فروش
 * که هرگز روی سیم نمی‌روند — همان تابع، چون فالبک زمینه‌ی ناامن پایینش
 * برای هردو مصرف یکسان لازم است.
 *
 * `crypto.randomUUID` در همه‌ی مرورگرهای هدف موجود است، ولی فقط در
 * زمینه‌ی امن (https یا localhost). جایگزین برای زمینه‌ی ناامن لازم است
 * وگرنه ثبت فاکتور روی http داخلی مغازه می‌شکند.
 */
export function generateUuid(): string {
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

function authHeader(): Record<string, string> {
  const accessToken = useSessionStore.getState().session?.accessToken;
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/**
 * تمدید هم‌زمان — چرخش توکن یعنی هر تمدید موفق، توکن تمدید قبلی را
 * باطل می‌کند (auth.service.ts، BE-011). اگر دو درخواست هم‌زمان هر دو
 * مستقل تمدید بزنند، دومی با توکنی که اولی همین الان باطل کرده رد
 * می‌شود — نشستی که کاملاً سالم بود را غلط منقضی نشان می‌دهد. یک
 * Promise مشترک این مسابقه را از ریشه حذف می‌کند: هرکس به این تابع
 * برسد، همان یک تمدید در حال اجرا را می‌بیند، نه تمدید تازه.
 *
 * بدون `callerSignal`: این یک منبع مشترک بین چند فراخوان هم‌زمان است؛
 * لغوشدن یکی از آن‌ها (مثلاً unmount یک کامپوننت) نباید تمدیدی را که
 * بقیه هنوز منتظرش‌اند از کار بیندازد.
 */
let refreshInFlight: Promise<SessionResponse> | null = null;

async function refreshAccessToken(): Promise<SessionResponse> {
  const current = useSessionStore.getState().session;
  if (!current) throw new ApiError(401, 'UNAUTHORIZED', 'نشستی برای تمدید وجود ندارد');

  refreshInFlight ??= request(
    '/auth/refresh',
    sessionResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    },
    undefined,
    DEFAULT_TIMEOUT_MS,
    { skipAuthRetry: true },
  ).finally(() => {
    refreshInFlight = null;
  });

  const session = await refreshInFlight;
  useSessionStore.getState().setSession(session);
  return session;
}

interface RequestOptions {
  /** برای `/auth/login|refresh|logout` — تمدید خودِ تمدید یعنی حلقه‌ی بی‌پایان. */
  skipAuthRetry?: boolean;
  /** این دومین تلاش همین درخواست است — یک بار تمدید کافی است، نه بی‌نهایت. */
  isRetryAfterRefresh?: boolean;
  /** درخواست اثر جانبی ندارد و پس از تمدید نشست می‌تواند بی‌صدا تکرار شود. */
  safeToRetryAfterRefresh?: boolean;
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
  options: RequestOptions = {},
): Promise<z.infer<S>> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = combineSignals([callerSignal, timeoutSignal]);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: 'application/json',
        'X-Request-Id': newRequestId(),
        ...authHeader(),
        ...init.headers,
      },
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

  if (response.status === 401 && !options.skipAuthRetry && !options.isRetryAfterRefresh) {
    if (!useSessionStore.getState().session) await parseError(response);

    try {
      await refreshAccessToken();
    } catch {
      // تمدید هم رد شد — نشست واقعاً مرده است، نه فقط توکن دسترسی
      useSessionStore.getState().clearSession();
      await parseError(response);
    }

    if ((init.method ?? 'GET') === 'GET' || options.safeToRetryAfterRefresh === true) {
      return request(path, schema, init, callerSignal, timeoutMs, {
        ...options,
        isRetryAfterRefresh: true,
      });
    }

    /*
     * قاعده‌ی FE-027: نوشتن مالی بعد از تمدید بدون کنترل دوباره ارسال
     * نمی‌شود. نشست الان معتبر است؛ فراخوان با همان Idempotency-Key
     * (که تغییر نکرده) دوباره `submit` می‌کند — امن است چون تکرار
     * همان کلید همان نتیجه را می‌گیرد، نه سند دوم.
     */
    throw new ApiError(409, 'RETRY_AFTER_REFRESH', 'نشست شما تازه شد؛ لطفاً دوباره ثبت کنید.');
  }

  if (response.status === 401) {
    // این دومین تلاش همین درخواست بود و باز هم ۴۰۱ گرفت، یا مسیر تمدید خودش بود
    useSessionStore.getState().clearSession();
  }

  if (!response.ok) await parseError(response);

  if (response.status === 204) {
    return undefined as z.infer<S>;
  }

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

/**
 * POST فقط‌خواندنی — برای endpointهایی که بدنه‌ی ورودی دارند، اما هیچ
 * سند یا اثر مالی ایجاد نمی‌کنند (مانند پیش‌نمایش قیمت‌گذاری).
 *
 * `Idempotency-Key` مخصوص نوشتن است؛ فرستادن آن برای یک preview این تصور
 * غلط را می‌سازد که درخواست، عملیات مالی قابل‌تکرار است.
 */
export function apiPostReadOnly<S extends z.ZodTypeAny>(
  path: string,
  body: unknown,
  schema: S,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<z.infer<S>> {
  return request(
    path,
    schema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    signal,
    timeoutMs,
    { safeToRetryAfterRefresh: true },
  );
}

/**
 * ویرایش جزئی — همان قرارداد `apiPost` (`Idempotency-Key` خودکار)، فقط با
 * متد `PATCH`. `PartyFormDialog` (FE-033) اولین مصرف‌کننده است.
 */
export function apiPatch<S extends z.ZodTypeAny>(
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
      method: 'PATCH',
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

/**
 * نوشتن بدون تمدید خودکار — فقط برای `/auth/login`, `/auth/refresh`,
 * `/auth/logout` (`api/auth.ts`). این سه خودشان چرخه‌ی نشست‌اند؛ اگر از
 * مسیر معمول با تمدید خودکار عبور کنند، یک ۴۰۱ روی تمدید یعنی تلاش
 * برای تمدیدِ همان تمدید — حلقه‌ی بی‌پایان.
 */
export function apiPostRaw<S extends z.ZodTypeAny>(
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
    { skipAuthRetry: true },
  );
}
