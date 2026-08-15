import { toSafeNumber } from '@gold/core-calc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useSessionStore } from '@/stores/session-store';
import { ApiError, NetworkError } from './api-error';
import { apiGet, apiPost, apiPostRaw, newIdempotencyKey } from './client';
import { dualAmountSchema } from './contracts';

/**
 * قرارداد مرز شبکه.
 *
 * این تست‌ها به MSW وابسته نیستند — `fetch` مستقیم جعل می‌شود تا خود
 * لایه‌ی کلاینت آزموده شود، نه پاسخ‌دهنده‌ی ساختگی.
 */

const okSchema = z.object({ value: z.string() });

/** امضای صریح لازم است تا `calls[0][1]` نوع `RequestInit` بگیرد. */
function mockFetch(response: { status?: number; body: unknown }) {
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(response.body), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** هدرهای فرستاده‌شده در n-امین فراخوانی. */
function sentHeaders(
  spy: ReturnType<typeof mockFetch>,
  index = 0,
): Record<string, string> {
  return (spy.mock.calls[index]?.[1]?.headers ?? {}) as Record<string, string>;
}

/**
 * fetch ای که خودش هرگز settle نمی‌شود — فقط وقتی `signal` (چه از فراخوان،
 * چه از timeout) لغو شود رد می‌شود. برای آزمودن timeout و abort واقعاً به
 * یک اتصال آویزان نیاز داریم، نه یک پاسخ فوری.
 */
function mockHangingFetch() {
  const spy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const rejectAborted = () => reject(new DOMException('عملیات لغو شد', 'AbortError'));
      if (signal?.aborted) {
        rejectAborted();
        return;
      }
      signal?.addEventListener('abort', rejectAborted);
    });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** پاسخ ۴۰۱ ساختاریافته — همان شکلی که `parseError` انتظار دارد. */
const UNAUTHORIZED_BODY = {
  error: { code: 'UNAUTHORIZED', message: 'دسترسی غیرمجاز', fields: {}, requestId: 'req-401' },
};

const SESSION_A = {
  accessToken: 'access-a',
  refreshToken: 'refresh-a',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'owner@example.com', displayName: 'مدیر' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role: 'OWNER',
};

const SESSION_B_WIRE = { ...SESSION_A, accessToken: 'access-b', refreshToken: 'refresh-b' };

/** جعل `fetch` با تابع دلخواه — برای رفتار متفاوت بر اساس مسیر یا شماره‌ی فراخوانی. */
function mockFetchWith(
  handler: (
    path: string,
    init: RequestInit | undefined,
    callIndex: number,
  ) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
) {
  let callIndex = 0;
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const index = callIndex;
    callIndex += 1;
    const { status, body } = await handler(String(input), init, index);
    return new Response(JSON.stringify(body), {
      status: status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useSessionStore.setState({ session: null });
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('تبدیل رشته به bigint روی مرز', () => {
  it('مقادیر پولی و وزنی از رشته به bigint تبدیل می‌شوند', async () => {
    mockFetch({ body: { rial: '196603630103', pureMg: '1330700', rate1000: '147744518' } });

    const result = await apiGet('/x', dualAmountSchema);

    expect(result.rial).toBe(196_603_630_103n);
    expect(result.pureMg).toBe(1_330_700n);
    expect(typeof result.rial).toBe('bigint');
  });

  it('مقادیری فراتر از MAX_SAFE_INTEGER بدون افت دقت عبور می‌کنند', async () => {
    const huge = '9007199254740993123'; // فراتر از توان number
    mockFetch({ body: { rial: huge, pureMg: '1', rate1000: '1' } });

    const result = await apiGet('/x', dualAmountSchema);

    expect(result.rial.toString()).toBe(huge);
    // اثبات اینکه مسیر number این عدد را خراب می‌کرد:
    // پل رسمی تبدیل، عمداً خطا می‌دهد به‌جای برگرداندن عدد نادرست
    expect(() => toSafeNumber(BigInt(huge))).toThrow();
  });

  it('عدد خام به‌جای رشته رد می‌شود — قرارداد نقض شده است', async () => {
    mockFetch({ body: { rial: 12500000, pureMg: '1', rate1000: '1' } });

    await expect(apiGet('/x', dualAmountSchema)).rejects.toThrow(ApiError);
  });

  it('پاسخ ناسازگار با اسکیما خطای SCHEMA_MISMATCH می‌دهد', async () => {
    mockFetch({ body: { unexpected: true } });

    await expect(apiGet('/x', okSchema)).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
  });
});

describe('Idempotency-Key', () => {
  it('روی هر نوشتن خودکار اضافه می‌شود', async () => {
    const spy = mockFetch({ body: { value: 'ok' } });

    await apiPost('/invoices', { a: 1 }, okSchema);

    expect(sentHeaders(spy)['Idempotency-Key']).toBeTruthy();
  });

  it('کلید داده‌شده حفظ می‌شود — تلاش مجدد همان عملیات، نه عملیات جدید', async () => {
    const spy = mockFetch({ body: { value: 'ok' } });

    await apiPost('/invoices', { a: 1 }, okSchema, 'fixed-key');

    expect(sentHeaders(spy)['Idempotency-Key']).toBe('fixed-key');
  });

  it('هر فراخوانی بدون کلید صریح، کلید یکتای خودش را می‌گیرد', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it('روی خواندن کلید فرستاده نمی‌شود', async () => {
    const spy = mockFetch({ body: { value: 'ok' } });

    await apiGet('/x', okSchema);

    expect(sentHeaders(spy)['Idempotency-Key']).toBeUndefined();
  });
});

describe('خطاها', () => {
  it('خطای ساختاریافته‌ی سرور به ApiError تبدیل می‌شود', async () => {
    mockFetch({
      status: 400,
      body: {
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'هدر اجباری است',
          fields: {},
          requestId: 'req-test-1',
        },
      },
    });

    await expect(apiPost('/invoices', {}, okSchema)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      status: 400,
      requestId: 'req-test-1',
    });
  });

  it('قطع شبکه پیام فارسی قابل نمایش می‌دهد', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));

    await expect(apiGet('/x', okSchema)).rejects.toThrow(NetworkError);
    await expect(apiGet('/x', okSchema)).rejects.toThrow('ارتباط با سرور برقرار نشد');
  });
});

describe('timeout و لغو', () => {
  it('گذشتن از سقف زمان، NetworkError با پیام «طول کشید» می‌دهد، نه AbortError خام', async () => {
    mockHangingFetch();

    const error: unknown = await apiGet('/x', okSchema, undefined, 20).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).message).toMatch(/طول کشید/);
    // اگر اینجا AbortError خام برگردد، یعنی تشخیص «چه کسی لغو کرد» غلط است
    expect((error as Error).name).not.toBe('AbortError');
  });

  it('لغو عمدی فراخوان دست‌نخورده بالا می‌رود — سازگار با لغو TanStack Query', async () => {
    mockHangingFetch();
    const controller = new AbortController();

    const promise = apiGet('/x', okSchema, controller.signal);
    controller.abort();
    const error: unknown = await promise.catch((e: unknown) => e);

    /*
     * اینجا عمداً NetworkError **نیست**: TanStack Query لغوهای خودش را با
     * `error.name === 'AbortError'` تشخیص می‌دهد و آن‌ها را «خطا» حساب
     * نمی‌کند. اگر این‌جا در NetworkError بپیچیمش، لغوهای عادی (مثلاً
     * وقتی کاربر زودتر از صفحه‌ی جست‌وجو بیرون می‌رود) مثل قطعی شبکه‌ی
     * واقعی نمایش داده می‌شوند.
     */
    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as Error).name).toBe('AbortError');
  });

  it('لغو فراخوان زودتر از پایان سقف زمان رخ می‌دهد و مانع NetworkError timeout می‌شود', async () => {
    mockHangingFetch();
    const controller = new AbortController();

    // سقف زمان طولانی؛ لغو فراخوان باید خیلی زودتر برنده شود
    const promise = apiGet('/x', okSchema, controller.signal, 5_000);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Authorization — FE-027', () => {
  it('با نشست فعال، هدر Bearer فرستاده می‌شود', async () => {
    useSessionStore.setState({ session: SESSION_A });
    const spy = mockFetch({ body: { value: 'ok' } });

    await apiGet('/x', okSchema);

    expect(sentHeaders(spy)['Authorization']).toBe('Bearer access-a');
  });

  it('بدون نشست، هدر Authorization اصلاً فرستاده نمی‌شود', async () => {
    const spy = mockFetch({ body: { value: 'ok' } });

    await apiGet('/x', okSchema);

    expect(sentHeaders(spy)['Authorization']).toBeUndefined();
  });
});

describe('تمدید خودکار روی ۴۰۱ — FE-027', () => {
  it('بدون نشست، ۴۰۱ بلافاصله پرتاب می‌شود — تلاشی برای تمدید نمی‌شود', async () => {
    const spy = mockFetch({ status: 401, body: UNAUTHORIZED_BODY });

    await expect(apiGet('/x', okSchema)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('GET: ۴۰۱ → تمدید موفق → همان درخواست بی‌صدا دوباره امتحان می‌شود', async () => {
    useSessionStore.setState({ session: SESSION_A });
    const spy = mockFetchWith((path, _init, index) => {
      if (path.includes('/auth/refresh')) return { body: SESSION_B_WIRE };
      if (index === 0) return { status: 401, body: UNAUTHORIZED_BODY };
      return { body: { value: 'ok' } };
    });

    const result = await apiGet('/x', okSchema);

    expect(result).toEqual({ value: 'ok' });
    expect(spy).toHaveBeenCalledTimes(3); // اول /x، بعد /auth/refresh، بعد دوباره /x
    expect(useSessionStore.getState().session?.accessToken).toBe('access-b');
    // تلاش دوم باید توکن تازه را حمل کند، نه توکن منقضی‌شده‌ی اول را
    expect(sentHeaders(spy, 2)['Authorization']).toBe('Bearer access-b');
  });

  it('نوشتن: ۴۰۱ → تمدید موفق → دوباره ارسال خودکار نمی‌شود، RETRY_AFTER_REFRESH می‌دهد', async () => {
    useSessionStore.setState({ session: SESSION_A });
    const spy = mockFetchWith((path, _init, index) => {
      if (path.includes('/auth/refresh')) return { body: SESSION_B_WIRE };
      if (index === 0) return { status: 401, body: UNAUTHORIZED_BODY };
      throw new Error('نباید دوباره /invoices صدا زده شود');
    });

    await expect(apiPost('/invoices', { a: 1 }, okSchema)).rejects.toMatchObject({
      code: 'RETRY_AFTER_REFRESH',
    });

    expect(spy).toHaveBeenCalledTimes(2); // فقط /invoices اول و /auth/refresh — نه یک بار دیگر /invoices
    // نشست معتبر است، نه پاک‌شده — کاربر هنوز واردشده، فقط باید دوباره ثبت کند
    expect(useSessionStore.getState().session?.accessToken).toBe('access-b');
  });

  it('تمدید هم رد شود: همان ۴۰۱ اصلی پرتاب و نشست پاک می‌شود', async () => {
    useSessionStore.setState({ session: SESSION_A });
    mockFetchWith((path, _init, index) => {
      if (path.includes('/auth/refresh')) {
        return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'نشست معتبر نیست یا منقضی شده است', fields: {}, requestId: 'req-refresh' } } };
      }
      if (index === 0) return { status: 401, body: UNAUTHORIZED_BODY };
      throw new Error('نباید دوباره تلاش شود');
    });

    await expect(apiGet('/x', okSchema)).rejects.toMatchObject({ requestId: 'req-401' });
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('تلاش دوم بعد از تمدید هم ۴۰۱ بگیرد: بدون حلقه، همان ۴۰۱ پرتاب و نشست پاک می‌شود', async () => {
    useSessionStore.setState({ session: SESSION_A });
    const spy = mockFetchWith((path) => {
      if (path.includes('/auth/refresh')) return { body: SESSION_B_WIRE };
      return { status: 401, body: UNAUTHORIZED_BODY }; // /x همیشه ۴۰۱ می‌دهد، حتی بعد از تمدید
    });

    await expect(apiGet('/x', okSchema)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(spy).toHaveBeenCalledTimes(3); // /x، /auth/refresh، دوباره /x — نه یک تمدید دوم
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('دو درخواست هم‌زمان با ۴۰۱، فقط یک تمدید می‌سازند — چرخش توکن اجازه‌ی دو تمدید هم‌زمان نمی‌دهد', async () => {
    useSessionStore.setState({ session: SESSION_A });
    let refreshCalls = 0;
    let releaseRefresh: () => void = () => {};
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let xCalls = 0;

    mockFetchWith(async (path) => {
      if (path.includes('/auth/refresh')) {
        refreshCalls += 1;
        await refreshGate;
        return { body: SESSION_B_WIRE };
      }
      xCalls += 1;
      if (xCalls <= 2) return { status: 401, body: UNAUTHORIZED_BODY };
      return { body: { value: 'ok' } };
    });

    const p1 = apiGet('/x', okSchema);
    const p2 = apiGet('/x', okSchema);

    // به هر دو زنجیره فرصت بده تا هر دو ۴۰۱ بگیرند و به مسیر تمدید برسند
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));

    releaseRefresh();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(refreshCalls).toBe(1);
    expect(r1).toEqual({ value: 'ok' });
    expect(r2).toEqual({ value: 'ok' });
  });
});

describe('پاسخ ۲۰۴ بدون بدنه — FE-027', () => {
  it('سعی نمی‌کند بدنه‌ی خالی را JSON.parse کند', async () => {
    useSessionStore.setState({ session: SESSION_A });
    // برخلاف mockFetch عمومی: بدنه واقعاً خالی — Response با ۲۰۴ اجازه‌ی بدنه ندارد
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(apiPostRaw('/auth/logout', {}, z.undefined())).resolves.toBeUndefined();
  });
});

describe('apiPostRaw — بدون تمدید خودکار (FE-027)', () => {
  it('روی ۴۰۱ تلاش برای تمدید نمی‌کند — برای جلوگیری از حلقه‌ی تمدیدِ تمدید', async () => {
    useSessionStore.setState({ session: SESSION_A });
    const spy = mockFetch({ status: 401, body: UNAUTHORIZED_BODY });

    await expect(apiPostRaw('/auth/refresh', {}, okSchema)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('X-Request-Id', () => {
  it('روی هر درخواست — چه خواندن چه نوشتن — فرستاده می‌شود', async () => {
    const spy = mockFetch({ body: { value: 'ok' } });

    await apiGet('/x', okSchema);

    expect(sentHeaders(spy)['X-Request-Id']).toBeTruthy();
  });

  it('هر درخواست شناسه‌ی جدای خودش را دارد', async () => {
    const spy = mockFetch({ body: { value: 'ok' } });

    await apiGet('/x', okSchema);
    await apiGet('/x', okSchema);

    expect(sentHeaders(spy, 0)['X-Request-Id']).not.toBe(sentHeaders(spy, 1)['X-Request-Id']);
  });
});
