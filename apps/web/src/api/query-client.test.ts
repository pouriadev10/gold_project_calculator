import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from './api-error';
import { createQueryClient, isRetryableError, setUnauthorizedHandler } from './query-client';

afterEach(() => setUnauthorizedHandler(null));

describe('isRetryableError', () => {
  it('SCHEMA_MISMATCH و UNKNOWN تلاش مجدد نمی‌شوند — مشکل شکل داده است، نه شبکه', () => {
    expect(isRetryableError(new ApiError(200, 'SCHEMA_MISMATCH', 'x'))).toBe(false);
    expect(isRetryableError(new ApiError(502, 'UNKNOWN', 'x'))).toBe(false);
  });

  it('۴xx تلاش مجدد نمی‌شود — درخواست دوباره همان ۴xx را می‌گیرد', () => {
    expect(isRetryableError(new ApiError(400, 'BAD_REQUEST', 'x'))).toBe(false);
    expect(isRetryableError(new ApiError(401, 'UNAUTHORIZED', 'x'))).toBe(false);
    expect(isRetryableError(new ApiError(404, 'NOT_FOUND', 'x'))).toBe(false);
  });

  it('۵xx تلاش مجدد می‌شود — می‌تواند موقتی باشد', () => {
    expect(isRetryableError(new ApiError(500, 'INTERNAL', 'x'))).toBe(true);
    expect(isRetryableError(new ApiError(503, 'UNAVAILABLE', 'x'))).toBe(true);
  });

  it('NetworkError تلاش مجدد می‌شود', () => {
    expect(isRetryableError(new NetworkError())).toBe(true);
  });

  it('خطای ناشناخته‌ی دیگر تلاش مجدد نمی‌شود', () => {
    expect(isRetryableError(new Error('چیز دیگر'))).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('mutations هرگز خودکار retry نمی‌شوند', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('queries تا سقف مشخص و فقط روی خطای قابل‌جبران retry می‌شوند', () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe('function');
    if (typeof retry !== 'function') throw new Error('retry باید تابع باشد');

    const retryable = new NetworkError();
    const notRetryable = new ApiError(404, 'NOT_FOUND', 'x');

    expect(retry(0, retryable)).toBe(true);
    expect(retry(1, retryable)).toBe(false); // به سقف رسیده
    expect(retry(0, notRetryable)).toBe(false);
  });

  it('staleTime و refetchOnWindowFocus پیش‌فرض حفظ شده‌اند', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it('هر فراخوانی یک client مستقل می‌سازد، نه singleton مشترک', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });

  it('۴۰۱ در یک query، هندلر ثبت‌شده‌ی نشست را صدا می‌زند', async () => {
    const client = createQueryClient();
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await client
      .fetchQuery({
        queryKey: ['test-401'],
        queryFn: () => Promise.reject(new ApiError(401, 'UNAUTHORIZED', 'نشست منقضی شد')),
      })
      .catch(() => {});

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('خطای غیر-۴۰۱ هندلر نشست را صدا نمی‌زند', async () => {
    const client = createQueryClient();
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await client
      .fetchQuery({
        queryKey: ['test-500'],
        queryFn: () => Promise.reject(new ApiError(500, 'INTERNAL', 'x')),
        // ۵۰۰ طبق isRetryableError قابل‌جبران است؛ اینجا فقط رفتار onError
        // سنجیده می‌شود، نه مکانیزم retry (که تست جدای خودش را دارد) —
        // retry:false از تأخیر backoff بی‌ربط به این تست جلوگیری می‌کند.
        retry: false,
      })
      .catch(() => {});

    expect(handler).not.toHaveBeenCalled();
  });
});
