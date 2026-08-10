import { toSafeNumber } from '@gold/core-calc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, NetworkError } from './api-error';
import { apiGet, apiPost, newIdempotencyKey } from './client';
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

beforeEach(() => vi.unstubAllGlobals());
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
