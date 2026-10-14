import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, NetworkError, OfflineError } from '@/api/api-error';
import type { SessionResponse } from '@/api/contracts';
import { SUBMIT_ATTEMPT_STORAGE_PREFIX } from '@/lib/submit-attempt-storage';
import { useSessionStore } from '@/stores/session-store';
import { isDefinitiveRejection, useFinancialSubmit } from './useFinancialSubmit';

const SESSION: SessionResponse = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'u@example.com', displayName: 'کاربر' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری', timezone: 'Asia/Tehran' },
  role: 'CASHIER',
};

interface Payload {
  readonly amountRial: string;
}
const schema = z.object({ amountRial: z.string().regex(/^\d+$/) });
const persist = { scope: 'test:form', schema };
const STORAGE_KEY = `${SUBMIT_ATTEMPT_STORAGE_PREFIX}t1:u1:test:form`;

type Action = (key: string, payload: Payload) => Promise<string>;

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  sessionStorage.clear();
  useSessionStore.setState({ session: SESSION });
});
afterEach(() => {
  useSessionStore.setState({ session: null });
});

describe('isDefinitiveRejection', () => {
  it.each([
    [new ApiError(400, 'BAD_REQUEST', ''), true],
    [new ApiError(401, 'UNAUTHORIZED', ''), true],
    [new ApiError(403, 'FORBIDDEN', ''), true],
    [new ApiError(404, 'NOT_FOUND', ''), true],
    [new ApiError(409, 'CONFLICT', ''), true],
    [new ApiError(409, 'RETRY_AFTER_REFRESH', ''), true],
    [new ApiError(422, 'VALIDATION_ERROR', ''), true],
    [new OfflineError(), true],
    [new ApiError(408, 'TIMEOUT', ''), false],
    [new ApiError(429, 'RATE_LIMITED', ''), false],
    [new ApiError(500, 'INTERNAL_ERROR', ''), false],
    [new ApiError(502, 'BAD_GATEWAY', ''), false],
    // پاسخ موفق با بدنه‌ای که قرارداد نمی‌خواند — یعنی سند ساخته شده
    [new ApiError(201, 'SCHEMA_MISMATCH', ''), false],
    [new NetworkError(), false],
    [new Error('هر چیز دیگر'), false],
  ])('%s → %s', (error, expected) => {
    expect(isDefinitiveRejection(error)).toBe(expected);
  });
});

describe('useFinancialSubmit', () => {
  it('ضربه‌های هم‌زمان فقط یک بار action را صدا می‌زنند', async () => {
    const pending = deferred();
    const action = vi.fn<Action>(() => pending.promise);
    const { result } = renderHook(() => useFinancialSubmit(action));

    let first!: Promise<string | undefined>;
    let second!: Promise<string | undefined>;
    act(() => {
      first = result.current.submit({ amountRial: '1' });
      second = result.current.submit({ amountRial: '2' });
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.locked).toBe(true);
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      pending.resolve('ok');
      await Promise.all([first, second]);
    });
    await expect(second).resolves.toBeUndefined();
    await expect(first).resolves.toBe('ok');
  });

  it('پس از خطای نامطمئن، قفل می‌ماند و تلاش بعدی همان کلید و همان بدنه را می‌فرستد — نه بدنه‌ی تازه', async () => {
    const action = vi
      .fn<Action>()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useFinancialSubmit(action));

    await act(async () => {
      await result.current.submit({ amountRial: '100' }).catch(() => undefined);
    });
    expect(result.current.uncertain).toBe(true);
    expect(result.current.locked).toBe(true);
    expect(result.current.pending?.payload).toEqual({ amountRial: '100' });

    await act(async () => {
      await result.current.submit({ amountRial: '999' });
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(action.mock.calls[1]).toEqual(action.mock.calls[0]);
    expect(result.current.locked).toBe(false);
    expect(result.current.uncertain).toBe(false);
  });

  it('retry() همان تلاش را تکرار می‌کند و بی‌تلاش کاری نمی‌کند', async () => {
    const action = vi.fn<Action>().mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', '')).mockResolvedValue('ok');
    const { result } = renderHook(() => useFinancialSubmit(action));

    await act(async () => {
      await expect(result.current.retry()).resolves.toBeUndefined();
    });
    expect(action).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.submit({ amountRial: '5' }).catch(() => undefined);
    });
    await act(async () => {
      await expect(result.current.retry()).resolves.toBe('ok');
    });
    expect(action.mock.calls[1]).toEqual(action.mock.calls[0]);
  });

  it('رد قطعی تلاش را رها می‌کند: فرم آزاد، بدنه‌ی اصلاح‌شده با همان کلید فرستاده می‌شود', async () => {
    const action = vi
      .fn<Action>()
      .mockRejectedValueOnce(new ApiError(422, 'VALIDATION_ERROR', ''))
      .mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useFinancialSubmit(action));

    await act(async () => {
      await result.current.submit({ amountRial: '1' }).catch(() => undefined);
    });
    expect(result.current.locked).toBe(false);
    expect(result.current.uncertain).toBe(false);

    await act(async () => {
      await result.current.submit({ amountRial: '2' });
    });
    expect(action.mock.calls[1]).toEqual([action.mock.calls[0]![0], { amountRial: '2' }]);
  });

  it('پس از موفقیت، ضربه‌ی دیرهنگام هیچ نمی‌فرستد تا reset() کلید تازه بسازد', async () => {
    const action = vi.fn<Action>().mockResolvedValue('ok');
    const { result } = renderHook(() => useFinancialSubmit(action));
    const firstKey = result.current.key;

    await act(async () => {
      await result.current.submit({ amountRial: '1' });
    });
    await act(async () => {
      await expect(result.current.submit({ amountRial: '1' })).resolves.toBeUndefined();
    });
    expect(action).toHaveBeenCalledTimes(1);

    act(() => result.current.reset());
    expect(result.current.key).not.toBe(firstKey);
    await act(async () => {
      await result.current.submit({ amountRial: '1' });
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(action.mock.calls[1]![0]).toBe(result.current.key);
  });

  it('reset() حین ارسال بی‌اثر است', async () => {
    const pending = deferred();
    const action = vi.fn<Action>(() => pending.promise);
    const { result } = renderHook(() => useFinancialSubmit(action));
    const key = result.current.key;

    let running!: Promise<string | undefined>;
    act(() => {
      running = result.current.submit({ amountRial: '1' });
    });
    act(() => result.current.reset());
    expect(result.current.key).toBe(key);
    expect(result.current.locked).toBe(true);

    await act(async () => {
      pending.resolve('ok');
      await running;
    });
  });

  describe('persist', () => {
    it('تلاش در جریان و نامطمئن ذخیره، و پس از remount به‌صورت «نامطمئن» بازیابی می‌شود', async () => {
      const action = vi.fn<Action>().mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce('ok');
      const first = renderHook(() => useFinancialSubmit(action, { persist }));

      await act(async () => {
        await first.result.current.submit({ amountRial: '700' }).catch(() => undefined);
      });
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!) as { key: string; payload: Payload };
      expect(stored).toEqual({ key: action.mock.calls[0]![0], payload: { amountRial: '700' } });
      first.unmount();

      const second = renderHook(() => useFinancialSubmit(action, { persist }));
      expect(second.result.current.uncertain).toBe(true);
      expect(second.result.current.locked).toBe(true);
      expect(second.result.current.key).toBe(stored.key);

      await act(async () => {
        await second.result.current.submit({ amountRial: '1' });
      });
      expect(action.mock.calls[1]).toEqual(action.mock.calls[0]);
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('رد قطعی و reset() تلاش ذخیره‌شده را پاک می‌کنند', async () => {
      const action = vi
        .fn<Action>()
        .mockRejectedValueOnce(new NetworkError())
        .mockRejectedValueOnce(new ApiError(422, 'VALIDATION_ERROR', ''))
        .mockRejectedValueOnce(new NetworkError());
      const { result } = renderHook(() => useFinancialSubmit(action, { persist }));

      await act(async () => {
        await result.current.submit({ amountRial: '1' }).catch(() => undefined);
      });
      expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
      await act(async () => {
        await result.current.retry().catch(() => undefined);
      });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

      await act(async () => {
        await result.current.submit({ amountRial: '2' }).catch(() => undefined);
      });
      expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
      act(() => result.current.reset());
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(result.current.locked).toBe(false);
    });

    it('داده‌ی خراب یا ناسازگار با schema نادیده گرفته می‌شود', () => {
      sessionStorage.setItem(STORAGE_KEY, '{not json');
      expect(renderHook(() => useFinancialSubmit(vi.fn<Action>(), { persist })).result.current.locked).toBe(false);

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ key: 'k', payload: { amountRial: 12 } }));
      expect(renderHook(() => useFinancialSubmit(vi.fn<Action>(), { persist })).result.current.locked).toBe(false);

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ key: '', payload: { amountRial: '12' } }));
      expect(renderHook(() => useFinancialSubmit(vi.fn<Action>(), { persist })).result.current.locked).toBe(false);
    });

    it('هر مستأجر/کاربر و هر scope تلاش خودش را دارد', () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ key: 'k1', payload: { amountRial: '12' } }));

      expect(renderHook(() => useFinancialSubmit(vi.fn<Action>(), { persist })).result.current.pending?.key).toBe('k1');
      expect(
        renderHook(() => useFinancialSubmit(vi.fn<Action>(), { persist: { ...persist, scope: 'other' } })).result.current
          .locked,
      ).toBe(false);

      useSessionStore.setState({ session: { ...SESSION, user: { ...SESSION.user, id: 'u2' } } });
      expect(renderHook(() => useFinancialSubmit(vi.fn<Action>(), { persist })).result.current.locked).toBe(false);

      // بدون نشست هیچ چیز خوانده یا نوشته نمی‌شود
      useSessionStore.setState({ session: null });
      expect(renderHook(() => useFinancialSubmit(vi.fn<Action>(), { persist })).result.current.locked).toBe(false);
    });

    it('عوض شدن scope روی همان نمونه، تلاش scope قبلی را کنار می‌گذارد و تلاش scope تازه را می‌خواند', () => {
      sessionStorage.setItem(`${SUBMIT_ATTEMPT_STORAGE_PREFIX}t1:u1:b`, JSON.stringify({ key: 'kb', payload: { amountRial: '9' } }));
      const { result, rerender } = renderHook(({ scope }) => useFinancialSubmit(vi.fn<Action>(), { persist: { scope, schema } }), {
        initialProps: { scope: 'a' },
      });
      expect(result.current.locked).toBe(false);

      rerender({ scope: 'b' });
      expect(result.current.pending).toEqual({ key: 'kb', payload: { amountRial: '9' } });

      rerender({ scope: 'a' });
      expect(result.current.locked).toBe(false);
      expect(result.current.key).not.toBe('kb');
    });

    it('storage ِ مسدود ثبت را خراب نمی‌کند — فقط بازیابی پس از ترک صفحه از دست می‌رود', async () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      const action = vi.fn<Action>().mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce('ok');
      const { result } = renderHook(() => useFinancialSubmit(action, { persist }));

      await act(async () => {
        await result.current.submit({ amountRial: '1' }).catch(() => undefined);
      });
      expect(result.current.uncertain).toBe(true);
      await act(async () => {
        await expect(result.current.retry()).resolves.toBe('ok');
      });
      setItem.mockRestore();
    });
  });
});
