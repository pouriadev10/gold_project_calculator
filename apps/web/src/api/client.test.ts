import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, NetworkError, apiGet, apiPost, newIdempotencyKey } from './client';
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
    // اثبات اینکه مسیر number این عدد را خراب می‌کرد
    expect(Number(huge).toString()).not.toBe(huge);
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
    mockFetch({ status: 400, body: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'هدر اجباری است' } });

    await expect(apiPost('/invoices', {}, okSchema)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      status: 400,
    });
  });

  it('قطع شبکه پیام فارسی قابل نمایش می‌دهد', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));

    await expect(apiGet('/x', okSchema)).rejects.toThrow(NetworkError);
    await expect(apiGet('/x', okSchema)).rejects.toThrow('ارتباط با سرور برقرار نشد');
  });
});
